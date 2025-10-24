// src/inlineProvider.ts
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { BackendClient } from './client';

type Ongoing = {
  abortController: AbortController;
  buffer: string;
};

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private cfgManager: ConfigManager;
  private client: BackendClient;
  private ongoingMap: Map<string, Ongoing> = new Map();
  private enabled: boolean = true;

  constructor(cfgManager: ConfigManager, backendBaseUrl: string) {
    this.cfgManager = cfgManager;
    this.client = new BackendClient(backendBaseUrl);
  }

  async provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position, context: vscode.InlineCompletionContext, token: vscode.CancellationToken) {
    // Respect setting
    const enabled = vscode.workspace.getConfiguration('nextgenai').get('enableInline', true) as boolean;
    if (!enabled) return [];

    const line = document.lineAt(position.line).text;
    const prefix = line.substring(0, position.character);
    const key = `${document.uri.toString()}@${position.line}:${position.character}`;

    // Cancel any previous ongoing request for this key
    const prev = this.ongoingMap.get(key);
    if (prev) {
      prev.abortController.abort();
      this.ongoingMap.delete(key);
    }

    // Build payload using config
    const cfg = await this.cfgManager.loadConfig();
    const feature = cfg.features.inline;
    const provider = feature.provider;
    const model = feature.model;

    const apiKey = await this.cfgManager.getApiKey(provider);

    const payload: any = {
      prefix,
      context: this.getContextSnippet(document, position, 20),
      language: document.languageId,
      model,
      api_key: apiKey
    };

    // Start background streaming
    const abortController = new AbortController();
    const ongoing: Ongoing = { abortController, buffer: '' };
    this.ongoingMap.set(key, ongoing);

    // stream and append to buffer; trigger editor to refresh inline suggestions
    (async () => {
      try {
        await this.client.streamComplete(payload, (chunk: string) => {
          ongoing.buffer += chunk;
          // trigger inline suggestion refresh
          vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
        }, abortController.signal);
      } catch (e) {
        // ignore or log
      } finally {
        // done
      }
    })();

    // Return the current buffer as a single suggestion (VS Code will render ghost text)
    const text = ongoing.buffer || '';
    const item: vscode.InlineCompletionItem = {
      insertText: text,
      range: new vscode.Range(position, position)
    };
    return [item];
  }

  // Helper to get surrounding text (N lines above)
  private getContextSnippet(document: vscode.TextDocument, position: vscode.Position, lines: number) {
    const startLine = Math.max(0, position.line - lines);
    const endLine = Math.min(document.lineCount - 1, position.line + lines);
    const rng = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, document.lineAt(endLine).text.length));
    return document.getText(rng);
  }
}
