# main.py
import os
import time
import json
import asyncio
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import FastAPI, Request, HTTPException, Body, Header
from fastapi.responses import StreamingResponse, JSONResponse
import httpx
from pydantic import BaseModel
from functools import wraps

# LangChain Google GenAI integration (for streaming)
from langchain_google_genai import ChatGoogleGenerativeAI
# Google GenAI SDK (for listing models)
from google import genai

from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="NextGenAI Backend (FastAPI + Google GenAI + LiteLLM adapter)")

# ---- Configuration ----
DEFAULT_GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
DEFAULT_PORT = int(os.environ.get("PORT", "8000"))

# supported provider keys
PROVIDERS = {"google", "litellm"}

# Simple in-memory cache for model lists with TTL
_MODEL_CACHE: Dict[str, Dict[str, Any]] = {}
MODEL_CACHE_TTL = 300  # seconds


# ---------- Pydantic models ----------
class MessageHistory(BaseModel):
    role: str
    content: str


class FetchModelsPayload(BaseModel):
    provider: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class ChatPayload(BaseModel):
    session_id: Optional[str] = None
    message: str
    model: Optional[str] = None
    temperature: Optional[float] = 0.0
    max_tokens: Optional[int] = None
    api_key: Optional[str] = None
    history: Optional[List[MessageHistory]] = []


class CompletePayload(BaseModel):
    prefix: str
    context: Optional[str] = ""
    language: Optional[str] = None
    filename: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = 0.0
    max_tokens: Optional[int] = 200
    api_key: Optional[str] = None


# ---------- Utility functions ----------
def cache_models(provider: str, models: List[str]):
    _MODEL_CACHE[provider] = {"models": models, "ts": time.time()}


def get_cached_models(provider: str) -> Optional[List[str]]:
    entry = _MODEL_CACHE.get(provider)
    if not entry:
        return None
    if time.time() - entry["ts"] > MODEL_CACHE_TTL:
        _MODEL_CACHE.pop(provider, None)
        return None
    return entry["models"]


def prefer_api_key(auth_header: Optional[str], body_key: Optional[str]) -> Optional[str]:
    """
    Prefer Authorization header Bearer token, then body api_key, then env default.
    """
    if auth_header:
        # expecting "Bearer <token>"
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            return parts[1]
        return auth_header  # fallback if header just contains raw key
    if body_key:
        return body_key
    return None


# ---------- Provider adapters ----------
async def google_list_models(api_key: Optional[str]) -> List[str]:
    api_key = api_key or DEFAULT_GOOGLE_API_KEY
    if not api_key:
        raise HTTPException(status_code=400, detail="Google API key not provided")

    try:
        client = genai.Client(api_key=api_key)
        models = []
        # SDK returns iterable/pager
        for m in client.models.list():
            # m may contain `name` (fully-qualified) or another attribute depending on SDK
            name = getattr(m, "name", None) or getattr(m, "model", None) or str(m)
            models.append(name)
        return models
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Google GenAI list models failed: {e}")


async def litellm_list_models(base_url: str) -> List[str]:
    if not base_url:
        raise HTTPException(status_code=400, detail="base_url required for litellm provider")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{base_url.rstrip('/')}/models")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"litellm responded {resp.status_code}: {resp.text}")
        data = resp.json()
        return data.get("models", [])


# ---------- Endpoints ----------

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/fetch_models")
async def fetch_models(payload: FetchModelsPayload, authorization: Optional[str] = Header(None)):
    """
    Fetch models for provider. Body includes provider, and either api_key or base_url (for litellm).
    The endpoint returns {"models": [...]}
    """
    provider = payload.provider.lower()
    api_key = prefer_api_key(authorization, payload.api_key)
    base_url = payload.base_url

    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    # return cached if exists
    cached = get_cached_models(provider)
    if cached:
        return JSONResponse({"models": cached, "cached": True})

    if provider == "google":
        models = await google_list_models(api_key=api_key)
    elif provider == "litellm":
        models = await litellm_list_models(base_url=base_url)
    else:
        models = []

    # cache result
    cache_models(provider, models)
    return JSONResponse({"models": models, "cached": False})


@app.get("/models")
async def models_list(provider: Optional[str] = None):
    """
    Return cached model lists or fetch from provider if cache miss.
    Query param: provider=google|litellm (optional)
    """
    if provider:
        provider = provider.lower()
        if provider not in PROVIDERS:
            raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")
        cached = get_cached_models(provider)
        if cached is not None:
            return JSONResponse({"provider": provider, "models": cached, "cached": True})
        # fallback to ask client to call /fetch_models with credentials
        raise HTTPException(status_code=404, detail="No cached models for provider; call /fetch_models with credentials")
    # return all cached
    data = {k: v["models"] for k, v in _MODEL_CACHE.items()}
    return JSONResponse({"cached_models": data})


@app.post("/chat")
async def chat_stream(
    payload: ChatPayload = Body(...),
    authorization: Optional[str] = Header(None),
):
    """
    Streaming chat endpoint with conversation history support.
    Accepts model, temperature, max_tokens, and full chat history.
    History format: [{"role": "user"|"assistant", "content": "..."}, ...]
    Uses Google GenAI via LangChain.
    Prefer Authorization header for api key; else payload.api_key; else env var.
    Returns StreamingResponse (text/plain, chunked).
    """
    api_key = prefer_api_key(authorization, payload.api_key) or DEFAULT_GOOGLE_API_KEY
    message = payload.message
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    model = payload.model or "gemini-2.5-flash"
    temperature = float(payload.temperature or 0.0)
    max_tokens = payload.max_tokens
    history = payload.history or []

    # Build messages list with history + current message
    messages = []
    
    # Add history to context
    if history:
        for msg in history:
            messages.append({
                "role": msg.get("role") if isinstance(msg, dict) else msg.role,
                "content": msg.get("content") if isinstance(msg, dict) else msg.content
            })
    
    # Add current message
    messages.append({
        "role": "user",
        "content": message
    })

    llm = ChatGoogleGenerativeAI(model=model, temperature=temperature, api_key=api_key)

    async def generator():
        try:
            async for chunk in llm.astream(input=messages):
                yield chunk.content
        except Exception as e:
            print(f"Error in chat_stream: {e}",type(e))
            try:
                error_message = json.loads(str(e))['message']
                print("Error message:", error_message)
                yield error_message
            except (json.JSONDecodeError, KeyError):
                print("Error in chat_stream: ", e)
                yield e

    return StreamingResponse(generator(), media_type="text/plain; charset=utf-8")


@app.post("/complete")
async def complete_stream(payload: CompletePayload = Body(...), authorization: Optional[str] = Header(None)):
    """
    Short completion endpoint optimized for inline suggestions.
    Builds a small prompt and streams tokens back.
    """
    api_key = prefer_api_key(authorization, payload.api_key) or DEFAULT_GOOGLE_API_KEY
    prefix = payload.prefix
    if prefix is None:
        raise HTTPException(status_code=400, detail="prefix is required")

    model = payload.model or "gemini-2.5-flash"
    temperature = float(payload.temperature or 0.0)
    max_tokens = payload.max_tokens or 200
    language = payload.language
    context_text = payload.context or ""

    llm = ChatGoogleGenerativeAI(model=model, temperature=temperature, api_key=api_key)

    if language:
        prompt = (
            f"You are an expert {language} programmer. Complete the code snippet below in a concise, "
            f"correct, and idiomatic way.\n\nContext:\n{context_text}\n\nPrefix:\n{prefix}\n\nCompletion:"
        )
    else:
        prompt = f"Complete this code:\n\n{context_text}\n\n{prefix}\n\nCompletion:"

    messages = [prompt]

    async def generator():
        async for chunk in llm.astream(input=messages):
            yield chunk.content

    return StreamingResponse(generator(), media_type="text/plain; charset=utf-8")