// src/client.ts
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';

export class BackendClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // Fetch models: sends provider, api_key (if present), base_url (optional)
  async fetchModels(provider: string, apiKey?: string, baseUrl?: string): Promise<string[]> {
    const body: any = { provider };
    if (apiKey) body.api_key = apiKey;
    if (baseUrl) body.base_url = baseUrl;
    const res = await fetch(`${this.baseUrl}/fetch_models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`fetch_models failed: ${res.status} ${txt}`);
    }
    const json = await res.json();
    return json.models ?? [];
  }

  // Stream chat - returns an async iterator of strings
  async streamChat(payload: any, onChunk: (chunk: string) => void, onDone?: () => void): Promise<void> {
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.body) throw new Error('No stream in response');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        onChunk(chunk);
      }
    } finally {
      onDone?.();
      reader.releaseLock();
    }
  }

  // Stream completion (inline suggestions)
  async streamComplete(payload: any, onChunk: (chunk: string) => void, signal?: AbortSignal): Promise<void> {
    const controller = new AbortController();
    const sig = signal ?? controller.signal;
    const res = await fetch(`${this.baseUrl}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: sig
    });
    if (!res.body) throw new Error('No stream body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        onChunk(chunk);
      }
    } finally {
      reader.releaseLock();
    }
  }
}
