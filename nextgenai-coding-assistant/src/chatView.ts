// src/chatView.ts
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { BackendClient } from './client';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'nextgenai.chatView';
  private _view?: vscode.WebviewView;
  private cfgManager: ConfigManager;
  private backendUrl: string;

  constructor(private readonly extensionUri: vscode.Uri, cfgManager: ConfigManager, backendUrl: string) {
    this.cfgManager = cfgManager;
    this.backendUrl = backendUrl;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'sendMessage':
          await this.onSendMessage(msg.message);
          break;
        case 'pinFile':
          await this.onPinFile();
          break;
        case 'openSettings':
          vscode.commands.executeCommand('nextgenai.openSettings');
          break;
      }
    });
  }

  private async onSendMessage(message: string) {
    if (!this._view) return;

    const cfg = await this.cfgManager.loadConfig();
    const feature = cfg.features.chat;
    const provider = feature.provider;
    const model = feature.model;

    // get api key if needed
    const apiKey = await this.cfgManager.getApiKey(provider);

    const payload: any = {
      message,
      model,
      api_key: apiKey
    };

    const client = new BackendClient(vscode.workspace.getConfiguration('nextgenai').get('baseUrl') as string || this.backendUrl);

    // Start streaming - don't post user message yet, let the webview do it
    this._view.webview.postMessage({ type: 'assistantStart' });
    
    try {
      await client.streamChat(payload, (chunk: string) => {
        // send chunk to webview to append to last assistant bubble
        this._view?.webview.postMessage({ type: 'stream', chunk });
      }, () => {
        this._view?.webview.postMessage({ type: 'done' });
      });
    } catch (error) {
      console.error('Chat error:', error);
      this._view?.webview.postMessage({ type: 'error', message: String(error) });
    }
  }

  private async onPinFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor to pin.');
      return;
    }
    // Add a small message into chat to indicate pinned file
    this._view?.webview.postMessage({ type: 'append', role: 'system', content: `📎 Pinned: ${editor.document.fileName}` });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
      }

      #header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-input-border);
        background: var(--vscode-sideBar-background);
        flex-shrink: 0;
      }

      .header-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
      }

      .header-icon {
        width: 16px;
        height: 16px;
        background: linear-gradient(135deg, #0d6efd, #0dcaf0);
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        color: white;
        font-weight: bold;
      }

      .header-actions {
        display: flex;
        gap: 4px;
      }

      .icon-btn {
        background: transparent;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .icon-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }

      #messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .message {
        display: flex;
        gap: 8px;
        animation: slideIn 0.3s ease;
      }

      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .message.user {
        justify-content: flex-end;
      }

      .message.assistant {
        justify-content: flex-start;
      }

      .message.system {
        justify-content: center;
      }

      .bubble {
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.5;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: pre-wrap;
      }

      .message.user .bubble {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border-bottom-right-radius: 3px;
      }

      .message.assistant .bubble {
        background: var(--vscode-input-background);
        color: var(--vscode-foreground);
        border: 1px solid var(--vscode-input-border);
        border-bottom-left-radius: 3px;
      }

      .message.system .bubble {
        background: rgba(13, 110, 253, 0.1);
        color: var(--vscode-descriptionForeground);
        font-size: 12px;
        border: 1px solid rgba(13, 110, 253, 0.3);
        max-width: 100%;
      }

      #controls {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--vscode-input-border);
        background: var(--vscode-sideBar-background);
        flex-shrink: 0;
      }

      #input {
        flex: 1;
        padding: 10px 12px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        transition: border-color 0.2s;
      }

      #input:focus {
        outline: none;
        border-color: var(--vscode-button-background);
        box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.1);
      }

      #send {
        padding: 10px 16px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
        white-space: nowrap;
      }

      #send:hover {
        background: var(--vscode-button-hoverBackground);
      }

      #send:active {
        opacity: 0.8;
      }

      #send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--vscode-descriptionForeground);
        text-align: center;
        padding: 24px;
      }

      .empty-icon {
        font-size: 48px;
        margin-bottom: 12px;
        opacity: 0.5;
      }

      .empty-title {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
        color: var(--vscode-foreground);
      }

      .empty-text {
        font-size: 12px;
        line-height: 1.5;
        max-width: 200px;
      }

      code {
        background: rgba(0, 0, 0, 0.2);
        padding: 2px 6px;
        border-radius: 3px;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        font-size: 12px;
      }

      pre {
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border);
        border-radius: 4px;
        padding: 12px;
        overflow-x: auto;
        margin: 8px 0;
        font-size: 12px;
      }

      pre code {
        background: none;
        padding: 0;
      }

      /* Scrollbar styling */
      #messages::-webkit-scrollbar {
        width: 8px;
      }

      #messages::-webkit-scrollbar-track {
        background: transparent;
      }

      #messages::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 4px;
      }

      #messages::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-hoverBackground);
      }
    </style>
  </head>
  <body>
    <div id="header">
      <div class="header-title">
        <div class="header-icon">✨</div>
        <span>NextGenAI</span>
      </div>
      <div class="header-actions">
        <button id="pin" class="icon-btn" title="Pin current file to chat">📎</button>
        <button id="settings" class="icon-btn" title="Open settings">⚙️</button>
      </div>
    </div>

    <div id="messages"></div>

    <div id="controls">
      <input id="input" placeholder="Ask me anything..." />
      <button id="send">↑</button>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      const messagesDiv = document.getElementById('messages');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('send');
      const pinBtn = document.getElementById('pin');
      const setBtn = document.getElementById('settings');

      let hasMessages = false;

      function showEmptyState() {
        messagesDiv.innerHTML = \`
          <div class="empty-state">
            <div class="empty-icon">💬</div>
            <div class="empty-title">Start a conversation</div>
            <div class="empty-text">Ask me questions about your code</div>
          </div>
        \`;
        hasMessages = false;
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function appendMessage(role, text) {
        if (!hasMessages) {
          messagesDiv.innerHTML = '';
          hasMessages = true;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ' + role;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.textContent = text;

        messageDiv.appendChild(bubble);
        messagesDiv.appendChild(messageDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        return bubble;
      }

      function appendToLastAssistant(text) {
        if (messagesDiv.lastElementChild && messagesDiv.lastElementChild.classList.contains('assistant')) {
          const bubble = messagesDiv.lastElementChild.querySelector('.bubble');
          bubble.textContent += text;
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
          return true;
        }
        return false;
      }

      sendBtn.onclick = () => {
        const txt = input.value.trim();
        if (!txt || sendBtn.disabled) return;

        // Add user message
        appendMessage('user', txt);
        
        // Clear input and disable send button
        input.value = '';
        sendBtn.disabled = true;

        // Send message to extension
        vscode.postMessage({ type: 'sendMessage', message: txt });
      };

      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      };

      pinBtn.onclick = () => {
        vscode.postMessage({ type: 'pinFile' });
      };

      setBtn.onclick = () => {
        vscode.postMessage({ type: 'openSettings' });
      };

      window.addEventListener('message', event => {
        const m = event.data;
        console.log('Chat received message:', m.type);
        
        if (m.type === 'assistantStart') {
          // Create empty assistant bubble
          appendMessage('assistant', '');
        } else if (m.type === 'stream') {
          // Append to last assistant message
          if (!appendToLastAssistant(m.chunk)) {
            // If no assistant message exists, create one
            appendMessage('assistant', m.chunk);
          }
        } else if (m.type === 'done') {
          // Enable send button
          sendBtn.disabled = false;
        } else if (m.type === 'append') {
          // For system messages
          appendMessage(m.role, m.content);
        } else if (m.type === 'error') {
          appendMessage('assistant', '❌ Error: ' + m.message);
          sendBtn.disabled = false;
        }
      });

      // Show empty state initially
      showEmptyState();
    </script>
  </body>
</html>`;
  }
}