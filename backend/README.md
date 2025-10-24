

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export GOOGLE_API_KEY="your-google-api-key"   # or supply per-request
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```


# Test curls

```bash
curl -s -X POST "http://localhost:8000/fetch_models" -H "Content-Type: application/json" \
  -d '{"provider":"google","api_key":"'"$GOOGLE_API_KEY"'"}' | jq
```

```bash
curl -N -H "Content-Type: application/json" -X POST "http://localhost:8000/chat" \
  -d '{"message":"Explain bubble sort in two sentences","model":"gemini-2.5-flash","api_key":"'"$GOOGLE_API_KEY"'"}'
```

```bash
curl -N -H "Content-Type: application/json" -X POST "http://localhost:8000/chat" \
  -d '{"message":"Explain bubble sort in two sentences","model":"gemini-2.5-flash","api_key":"'"$GOOGLE_API_KEY"'"}'
```

```bash
curl -N -H "Content-Type: application/json" -X POST "http://localhost:8000/complete" \
  -d '{"prefix":"def add(a, b):\\n    ","language":"python","model":"gemini-2.5-flash","api_key":"'"$GOOGLE_API_KEY"'"}'
```