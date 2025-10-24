// src/chatView.ts
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { BackendClient } from './client';
import { ChatStorage, ChatMessage, Conversation } from './chatStorage';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'nextgenai.chatView';
  private _view?: vscode.WebviewView;
  private cfgManager: ConfigManager;
  private backendUrl: string;
  private chatStorage: ChatStorage;
  private currentConversationId: string | null = null;

  constructor(private readonly extensionUri: vscode.Uri, cfgManager: ConfigManager, backendUrl: string, chatStorage: ChatStorage) {
    this.cfgManager = cfgManager;
    this.backendUrl = backendUrl;
    this.chatStorage = chatStorage;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      console.log('ChatView received message:', msg.type);
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
        case 'newConversation':
          await this.onNewConversation();
          break;
        case 'loadConversation':
          await this.onLoadConversation(msg.conversationId);
          break;
        case 'deleteConversation':
          await this.onDeleteConversation(msg.conversationId);
          break;
        case 'confirmDelete':
          try {
            const confirmed = await vscode.window.showWarningMessage(
              `Delete conversation "${msg.title}"?`,
              { modal: true },
              'Delete'
            );
            if (confirmed === 'Delete') {
              console.log('User confirmed delete for:', msg.conversationId);
              await this.onDeleteConversation(msg.conversationId);
            }
          } catch (error) {
            console.error('Error in delete confirmation:', error);
          }
          break;
        case 'viewReady':
          await this.initializeChat();
          break;
      }
    });
  }

  private async initializeChat() {
    try {
      const conversations = await this.chatStorage.getAllConversations();
      console.log('Loaded conversations:', conversations);

      if (conversations.length === 0) {
        console.log('No conversations found, creating new one');
        const newConv = await this.chatStorage.createConversation('New Conversation');
        this.currentConversationId = newConv.id;
        console.log('Created conversation:', newConv.id);
        this._view?.webview.postMessage({
          type: 'currentConversation',
          id: newConv.id,
          title: newConv.title
        });
      } else {
        // Load the most recent conversation
        const mostRecent = conversations[0];
        this.currentConversationId = mostRecent.id;
        console.log('Loading most recent conversation:', mostRecent.id);
        const messages = await this.chatStorage.getMessages(mostRecent.id);
        this._view?.webview.postMessage({
          type: 'loadMessages',
          conversationId: mostRecent.id,
          messages,
          title: mostRecent.title
        });
      }

      await this.loadConversationList();
    } catch (error) {
      console.error('Error initializing chat:', error);
    }
  }

  private async onSendMessage(message: string) {
    if (!this._view || !this.currentConversationId) {
      console.error('No conversation selected');
      return;
    }

    console.log('Saving user message to DB for conversation:', this.currentConversationId);

    try {
      // Save user message to database
      await this.chatStorage.addMessage(this.currentConversationId, 'user', message);

      const cfg = await this.cfgManager.loadConfig();
      const feature = cfg.features.chat;
      const provider = feature.provider;
      const model = feature.model;

      // Get api key if needed
      const apiKey = await this.cfgManager.getApiKey(provider);

      if (!model) {
        this._view?.webview.postMessage({
          type: 'error',
          message: 'No model configured. Please configure a model in settings.'
        });
        return;
      }

      // Get full conversation history
      const messages = await this.chatStorage.getMessages(this.currentConversationId);
      const history = messages
        .filter((m) => m.id !== undefined)
        .map((m) => ({ role: m.role, content: m.content }));

      console.log('Sending message with history length:', history.length);

      const payload: any = {
        message,
        model,
        api_key: apiKey,
        history
      };

      const client = new BackendClient(
        vscode.workspace.getConfiguration('nextgenai').get('baseUrl') as string || this.backendUrl
      );

      // Start streaming - assistant bubble will be created
      this._view.webview.postMessage({ type: 'assistantStart' });

      let fullResponse = '';

      await client.streamChat(
        payload,
        (chunk: string) => {
          fullResponse += chunk;
          // send chunk to webview to append to last assistant bubble
          this._view?.webview.postMessage({ type: 'stream', chunk });
        },
        () => {
          this._view?.webview.postMessage({ type: 'done' });
        }
      );

      // Save assistant response to database
      console.log('Saving assistant response to DB');
      await this.chatStorage.addMessage(this.currentConversationId, 'assistant', fullResponse);

      // Update conversation title if it's the first exchange
      const allMessages = await this.chatStorage.getMessages(this.currentConversationId);
      if (allMessages.length === 2) {
        // First user message and first assistant response
        const title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
        console.log('Updating conversation title to:', title);
        await this.chatStorage.updateConversationTitle(this.currentConversationId, title);
        await this.loadConversationList();
      }
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
    this._view?.webview.postMessage({
      type: 'append',
      role: 'system',
      content: `📎 Pinned: ${editor.document.fileName}`
    });
  }

  private async onNewConversation() {
    console.log('Creating new conversation');
    try {
      const conversation = await this.chatStorage.createConversation('New Conversation');
      this.currentConversationId = conversation.id;
      console.log('New conversation created:', conversation.id);
      this._view?.webview.postMessage({ type: 'clearMessages' });
      this._view?.webview.postMessage({
        type: 'currentConversation',
        id: conversation.id,
        title: conversation.title
      });
      await this.loadConversationList();
    } catch (error) {
      console.error('Error creating conversation:', error);
    }
  }

  private async onLoadConversation(conversationId: string) {
    console.log('Loading conversation:', conversationId);
    try {
      this.currentConversationId = conversationId;
      const messages = await this.chatStorage.getMessages(conversationId);
      const conversations = await this.chatStorage.getAllConversations();
      const current = conversations.find((c) => c.id === conversationId);

      console.log('Loaded messages:', messages.length);

      this._view?.webview.postMessage({
        type: 'loadMessages',
        conversationId,
        messages,
        title: current?.title
      });
    } catch (error) {
      console.error('Error loading conversation:', error);
    }
  }

  private async onDeleteConversation(conversationId: string) {
    console.log('Deleting conversation:', conversationId);
    try {
      await this.chatStorage.deleteConversation(conversationId);
      if (this.currentConversationId === conversationId) {
        await this.onNewConversation();
      }
      await this.loadConversationList();
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  }

  private async loadConversationList() {
    try {
      const conversations = await this.chatStorage.getAllConversations();
      console.log('Loaded conversation list:', conversations.length);
      this._view?.webview.postMessage({
        type: 'conversationList',
        conversations,
        currentId: this.currentConversationId
      });
    } catch (error) {
      console.error('Error loading conversation list:', error);
    }
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
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
      }

      .header {
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
      }

      #send:hover {
        background: var(--vscode-button-hoverBackground);
      }

      #send:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .sidebar-panel {
        display: none;
        position: absolute;
        right: 0;
        top: 0;
        width: 300px;
        height: 100%;
        background: var(--vscode-sideBar-background);
        border-left: 1px solid var(--vscode-input-border);
        z-index: 1000;
        flex-direction: column;
        overflow: hidden;
      }

      .sidebar-panel.active {
        display: flex;
      }

      .sidebar-header {
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-input-border);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }

      .sidebar-title {
        font-weight: 600;
        font-size: 13px;
      }

      .new-conv-btn {
        background: transparent;
        border: none;
        color: var(--vscode-foreground);
        cursor: pointer;
        font-size: 16px;
        padding: 4px;
        border-radius: 3px;
        transition: background 0.2s;
      }

      .new-conv-btn:hover {
        background: var(--vscode-button-hoverBackground);
      }

      #conversationsList {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
      }

      .conversation-item {
        padding: 10px 12px;
        margin-bottom: 4px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
        display: flex;
        justify-content: space-between;
        align-items: center;
        overflow: hidden;
        user-select: none;
      }

      .conversation-item:hover {
        background: var(--vscode-input-background);
        border-color: var(--vscode-input-border);
      }

      .conversation-item.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      .conversation-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .conversation-delete {
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 2px 4px;
        font-size: 12px;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .conversation-item:hover .conversation-delete {
        opacity: 1;
      }

      .conversation-delete:hover {
        color: #f48771;
      }

      #scrollButton {
        position: fixed;
        bottom: 100px;
        right: 20px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        font-size: 20px;
        cursor: pointer;
        display: none;
        z-index: 100;
      }

      #scrollButton:hover {
        background: var(--vscode-button-hoverBackground);
      }

      /* Scrollbar styling */
      #messages::-webkit-scrollbar,
      #conversationsList::-webkit-scrollbar {
        width: 8px;
      }

      #messages::-webkit-scrollbar-track,
      #conversationsList::-webkit-scrollbar-track {
        background: transparent;
      }

      #messages::-webkit-scrollbar-thumb,
      #conversationsList::-webkit-scrollbar-thumb {
        background: var(--vscode-scrollbarSlider-background);
        border-radius: 4px;
      }

      #messages::-webkit-scrollbar-thumb:hover,
      #conversationsList::-webkit-scrollbar-thumb:hover {
        background: var(--vscode-scrollbarSlider-hoverBackground);
      }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="header-title">
        <div class="header-icon">✨</div>
        <span id="headerTitle">NextGenAI</span>
      </div>
      <div class="header-actions">
        <button id="historyBtn" class="icon-btn" title="Conversation history">📋</button>
        <button id="pin" class="icon-btn" title="Pin current file">📎</button>
        <button id="settings" class="icon-btn" title="Settings">⚙️</button>
      </div>
    </div>

    <div id="messages"></div>

    <div id="controls">
      <input id="input" placeholder="Ask me anything..." />
      <button id="send">↑</button>
    </div>

    <div id="sidebarPanel" class="sidebar-panel">
      <div class="sidebar-header">
        <span class="sidebar-title">Conversations</span>
        <button id="newConvBtn" class="new-conv-btn" title="New conversation">+</button>
      </div>
      <div id="conversationsList"></div>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      const messagesDiv = document.getElementById('messages');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('send');
      const pinBtn = document.getElementById('pin');
      const setBtn = document.getElementById('settings');
      const newConvBtn = document.getElementById('newConvBtn');
      const historyBtn = document.getElementById('historyBtn');
      const sidebarPanel = document.getElementById('sidebarPanel');
      const conversationsList = document.getElementById('conversationsList');
      const headerTitle = document.getElementById('headerTitle');

      let hasMessages = false;
      let currentConversationId = null;

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

      function renderConversations(conversations, activeId) {
        conversationsList.innerHTML = '';
        conversations.forEach((conv) => {
          const item = document.createElement('div');
          item.className = 'conversation-item' + (conv.id === activeId ? ' active' : '');
          item.innerHTML = \`
            <span class="conversation-title">\${escapeHtml(conv.title)}</span>
            <button class="conversation-delete" data-id="\${conv.id}">✕</button>
          \`;

          item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('conversation-delete')) {
              console.log('Loading conversation:', conv.id);
              vscode.postMessage({ type: 'loadConversation', conversationId: conv.id });
              sidebarPanel.classList.remove('active');
            }
          });

          item.querySelector('.conversation-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ 
              type: 'confirmDelete', 
              conversationId: conv.id,
              title: conv.title
            });
          });

          conversationsList.appendChild(item);
        });
      }

      sendBtn.onclick = () => {
        const txt = input.value.trim();
        if (!txt || sendBtn.disabled || !currentConversationId) return;

        console.log('Sending message, current conversation:', currentConversationId);
        appendMessage('user', txt);
        input.value = '';
        sendBtn.disabled = true;

        vscode.postMessage({ type: 'sendMessage', message: txt });
      };

      input.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendBtn.click();
        }
      };

      historyBtn.onclick = () => {
        sidebarPanel.classList.toggle('active');
      };

      pinBtn.onclick = () => {
        vscode.postMessage({ type: 'pinFile' });
      };

      setBtn.onclick = () => {
        vscode.postMessage({ type: 'openSettings' });
      };

      newConvBtn.onclick = () => {
        console.log('New conversation button clicked');
        vscode.postMessage({ type: 'newConversation' });
        sidebarPanel.classList.remove('active');
      };

      window.addEventListener('message', event => {
        const m = event.data;
        console.log('Chat webview received message:', m.type, m);

        if (m.type === 'assistantStart') {
          appendMessage('assistant', '');
        } else if (m.type === 'stream') {
          if (!appendToLastAssistant(m.chunk)) {
            appendMessage('assistant', m.chunk);
          }
        } else if (m.type === 'done') {
          sendBtn.disabled = false;
        } else if (m.type === 'append') {
          appendMessage(m.role, m.content);
        } else if (m.type === 'error') {
          appendMessage('assistant', '❌ Error: ' + m.message);
          sendBtn.disabled = false;
        } else if (m.type === 'clearMessages') {
          messagesDiv.innerHTML = '';
          hasMessages = false;
        } else if (m.type === 'conversationList') {
          renderConversations(m.conversations, m.currentId);
        } else if (m.type === 'loadMessages') {
          console.log('Loading messages, count:', m.messages?.length);
          currentConversationId = m.conversationId;
          messagesDiv.innerHTML = '';
          if (m.messages && m.messages.length > 0) {
            hasMessages = true;
            m.messages.forEach((msg) => {
              appendMessage(msg.role, msg.content);
            });
          } else {
            hasMessages = false;
            messagesDiv.innerHTML = '';
          }
          headerTitle.textContent = m.title || 'NextGenAI';
          sendBtn.disabled = false;
        } else if (m.type === 'currentConversation') {
          console.log('Current conversation set:', m.id);
          currentConversationId = m.id;
          headerTitle.textContent = m.title || 'NextGenAI';
          messagesDiv.innerHTML = '';
          hasMessages = false;
          sendBtn.disabled = false;
        }
      });

      console.log('Chat webview initializing');
      vscode.postMessage({ type: 'viewReady' });
    </script>
  </body>
</html>`;
  }
}