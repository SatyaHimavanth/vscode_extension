// src/settingsPanel.ts
import * as vscode from 'vscode';
import { ConfigManager, NextGenConfig } from './configManager';
import { BackendClient } from './client';

export class SettingsPanel {
  public static currentPanel: SettingsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private configManager: ConfigManager;
  private backendUrl: string;
  private disposables: vscode.Disposable[] = [];

  private constructor(extensionUri: vscode.Uri, panel: vscode.WebviewPanel, configManager: ConfigManager, backendUrl: string) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.configManager = configManager;
    this.backendUrl = backendUrl;

    // Set the webview's initial html
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Listen for messages from the webview
    this._panel.webview.onDidReceiveMessage(async (message) => {
      console.log('Settings panel received message:', message.type, message);
      switch (message.type) {
        case 'load':
          {
            const cfg = await this.configManager.loadConfig();
            const providers = Object.keys(cfg.apis);
            // Provide masked keys info
            const keys: any = {};
            for (const p of providers) {
              const k = await this.configManager.getApiKey(p);
              keys[p] = !!k;
            }
            console.log('Loaded config:', cfg, 'Keys status:', keys);
            this._panel.webview.postMessage({ type: 'loaded', config: cfg, hasKeys: keys });
          }
          break;
        case 'setApiKey':
          {
            const { provider, apiKey } = message;
            console.log('Setting API key for provider:', provider, 'Key length:', apiKey?.length);
            if (apiKey && apiKey.trim()) {
              await this.configManager.setApiKey(provider, apiKey.trim());
              console.log('API key saved successfully');
              this._panel.webview.postMessage({ type: 'apiKeySaved', provider });
            } else {
              this._panel.webview.postMessage({ type: 'error', message: 'API key cannot be empty' });
            }
          }
          break;
        case 'fetchModels':
          {
            const { provider } = message;
            console.log('Fetching models for provider:', provider);
            const cfg = await this.configManager.loadConfig();
            const providerCfg = cfg.apis[provider];
            const apiKey = await this.configManager.getApiKey(provider);
            
            if (!apiKey) {
              this._panel.webview.postMessage({ type: 'fetchError', provider, message: 'API key not configured' });
              return;
            }

            const client = new BackendClient(this.backendUrl);
            try {
              console.log('Calling fetchModels with provider:', provider, 'baseUrl:', providerCfg?.base_url);
              const models = await client.fetchModels(provider, apiKey, providerCfg?.base_url);
              console.log('Fetched models:', models);
              // update config and send back
              cfg.apis[provider].models = models;
              await this.configManager.saveConfig(cfg);
              this._panel.webview.postMessage({ type: 'fetchedModels', provider, models });
            } catch (err: any) {
              console.error('Error fetching models:', err);
              this._panel.webview.postMessage({ type: 'fetchError', provider, message: err.message });
            }
          }
          break;
        case 'saveConfig':
          {
            const cfg: NextGenConfig = message.config;
            console.log('Saving config:', cfg);
            // Do not include API keys here
            await this.configManager.saveConfig(cfg);
            this._panel.webview.postMessage({ type: 'saved' });
          }
          break;
      }
    }, null, this.disposables);
  }

  public static async createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext, cfgManager: ConfigManager) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (SettingsPanel.currentPanel) {
      SettingsPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'nextgenaiSettings',
      'NextGenAI Settings',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    const baseUrl = vscode.workspace.getConfiguration('nextgenai').get('baseUrl') as string || 'http://localhost:8000';
    SettingsPanel.currentPanel = new SettingsPanel(extensionUri, panel, cfgManager, baseUrl);

    panel.onDidDispose(() => {
      SettingsPanel.currentPanel = undefined;
    }, null, []);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>NextGenAI Settings</title>
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
            padding: 24px;
            font-size: 13px;
            line-height: 1.6;
          }

          .container {
            max-width: 800px;
            margin: 0 auto;
          }

          h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
          }

          .subtitle {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 24px;
            font-size: 12px;
          }

          .section {
            margin-bottom: 32px;
          }

          .section-header {
            display: flex;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-input-border);
          }

          .section-title {
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-foreground);
          }

          .section-icon {
            display: inline-block;
            width: 4px;
            height: 4px;
            background: var(--vscode-button-background);
            border-radius: 2px;
            margin-right: 8px;
          }

          .provider-card {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 12px;
            transition: all 0.2s;
          }

          .provider-card:hover {
            border-color: var(--vscode-button-background);
            background: var(--vscode-editor-background);
          }

          .provider-name {
            font-weight: 600;
            font-size: 14px;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .provider-icon {
            display: inline-block;
            width: 12px;
            height: 12px;
            border-radius: 2px;
            background: var(--vscode-button-background);
          }

          .provider-status {
            display: inline-block;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 3px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: auto;
          }

          .provider-status.configured {
            background: rgba(76, 175, 80, 0.2);
            color: #4caf50;
          }

          .form-group {
            margin-bottom: 12px;
          }

          label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            margin-bottom: 6px;
            color: var(--vscode-foreground);
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }

          input[type="text"],
          input[type="password"],
          select {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 12px;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            transition: border-color 0.2s;
          }

          input[type="text"]:focus,
          input[type="password"]:focus,
          select:focus {
            outline: none;
            border-color: var(--vscode-button-background);
            box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.1);
          }

          .button-group {
            display: flex;
            gap: 8px;
            margin-top: 12px;
            flex-wrap: wrap;
          }

          button {
            flex: 1;
            min-width: 100px;
            padding: 8px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            text-overflow: ellipsis;
            overflow: hidden;
          }

          button:hover {
            background: var(--vscode-button-hoverBackground);
          }

          button:active {
            opacity: 0.8;
          }

          button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }

          button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }

          button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .models-list {
            margin-top: 12px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            max-height: 120px;
            overflow-y: auto;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            line-height: 1.4;
          }

          .models-list strong {
            color: var(--vscode-foreground);
          }

          .feature-row {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .feature-name {
            font-weight: 600;
            font-size: 13px;
            color: var(--vscode-foreground);
          }

          .feature-controls {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }

          .feature-controls select {
            flex: 1;
            min-width: 150px;
          }

          .actions {
            display: flex;
            gap: 12px;
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid var(--vscode-input-border);
          }

          .actions button {
            flex: 1;
          }

          .actions button.primary {
            background: var(--vscode-button-background);
          }

          .loading {
            display: inline-block;
            color: var(--vscode-descriptionForeground);
          }

          .spinner {
            display: inline-block;
            width: 12px;
            height: 12px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }

          @keyframes spin {
            to { transform: rotate(360deg); }
          }

          .info-box {
            background: rgba(13, 110, 253, 0.1);
            border-left: 3px solid #0d6efd;
            padding: 12px;
            border-radius: 4px;
            font-size: 12px;
            margin-bottom: 16px;
            color: var(--vscode-foreground);
          }

          .hidden {
            display: none !important;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>NextGenAI Settings</h1>
          <p class="subtitle">Configure AI providers, API keys, and feature models</p>

          <div id="container">
            <div class="loading">
              <span class="spinner"></span> Loading configuration...
            </div>
          </div>
        </div>

        <script>
          const vscode = acquireVsCodeApi();

          function escapeHtml(s) {
            return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
          }

          window.addEventListener('message', event => {
            const msg = event.data;
            console.log('Settings webview received:', msg.type);
            if (msg.type === 'loaded') {
              render(msg.config, msg.hasKeys);
            } else if (msg.type === 'fetchedModels') {
              alert('✓ Models fetched and saved for ' + msg.provider);
              vscode.postMessage({ type: 'load' });
            } else if (msg.type === 'saved') {
              alert('✓ Configuration saved successfully');
            } else if (msg.type === 'apiKeySaved') {
              alert('✓ API key saved for ' + msg.provider);
              vscode.postMessage({ type: 'load' });
            } else if (msg.type === 'fetchError') {
              alert('✗ Error: ' + msg.message);
            } else if (msg.type === 'error') {
              alert('✗ ' + msg.message);
            }
          });

          function render(cfg, hasKeys) {
            const container = document.getElementById('container');
            container.innerHTML = '';

            // Info box
            const infoBox = document.createElement('div');
            infoBox.className = 'info-box';
            infoBox.innerHTML = '💡 Add your API keys and select which provider/model to use for each feature.';
            container.appendChild(infoBox);

            // API Providers Section
            const providersDiv = document.createElement('div');
            providersDiv.className = 'section';
            providersDiv.innerHTML = '<div class="section-header"><span class="section-icon"></span><div class="section-title">API Providers</div></div>';

            for (const p of Object.keys(cfg.apis)) {
              const pc = cfg.apis[p];
              const div = document.createElement('div');
              div.className = 'provider-card';

              const header = document.createElement('div');
              header.className = 'provider-name';
              header.innerHTML = \`<span class="provider-icon"></span>\${escapeHtml(p)}<span class="provider-status \${hasKeys[p] ? 'configured' : ''}">\${hasKeys[p] ? '✓ Configured' : '❌ Not configured'}</span>\`;
              div.appendChild(header);

              // Base URL
              const urlGroup = document.createElement('div');
              urlGroup.className = 'form-group';
              const urlLabel = document.createElement('label');
              urlLabel.textContent = 'Base URL (optional)';
              const baseUrlInput = document.createElement('input');
              baseUrlInput.type = 'text';
              baseUrlInput.value = pc.base_url || '';
              baseUrlInput.placeholder = 'https://api.example.com';
              baseUrlInput.onchange = () => pc.base_url = baseUrlInput.value;
              urlGroup.appendChild(urlLabel);
              urlGroup.appendChild(baseUrlInput);
              div.appendChild(urlGroup);

              // API Key Input
              const keyGroup = document.createElement('div');
              keyGroup.className = 'form-group';
              const keyLabel = document.createElement('label');
              keyLabel.textContent = 'API Key';
              const keyInput = document.createElement('input');
              keyInput.type = 'password';
              keyInput.placeholder = hasKeys[p] ? '••••••••••••••••' : 'Enter your API key...';
              keyInput.value = '';
              keyGroup.appendChild(keyLabel);
              keyGroup.appendChild(keyInput);
              div.appendChild(keyGroup);

              // Buttons
              const btnGroup = document.createElement('div');
              btnGroup.className = 'button-group';

              const keyBtn = document.createElement('button');
              keyBtn.textContent = hasKeys[p] ? '✓ Save API Key' : '+ Save API Key';
              keyBtn.onclick = () => {
                const key = keyInput.value;
                if (key.trim()) {
                  console.log('Sending API key to extension for provider:', p);
                  vscode.postMessage({ type: 'setApiKey', provider: p, apiKey: key });
                  keyInput.value = '';
                } else {
                  alert('API key cannot be empty');
                }
              };
              btnGroup.appendChild(keyBtn);

              const fetchBtn = document.createElement('button');
              fetchBtn.className = 'secondary';
              fetchBtn.textContent = '⬇ Fetch Models';
              fetchBtn.onclick = () => {
                if (!hasKeys[p]) {
                  alert('Please add an API key first');
                  return;
                }
                fetchBtn.disabled = true;
                fetchBtn.innerHTML = '<span class="spinner"></span>';
                console.log('Requesting fetch models for', p);
                vscode.postMessage({ type: 'fetchModels', provider: p });
                setTimeout(() => {
                  fetchBtn.disabled = false;
                  fetchBtn.textContent = '⬇ Fetch Models';
                }, 3000);
              };
              btnGroup.appendChild(fetchBtn);
              div.appendChild(btnGroup);

              // Models List
              if (pc.models && pc.models.length) {
                const modelsList = document.createElement('div');
                modelsList.className = 'models-list';
                const displayed = pc.models.slice(0, 8);
                const more = pc.models.length > 8 ? pc.models.length - 8 : 0;
                let modelsHtml = \`<strong>Available models (\${pc.models.length}):</strong><br />\`;
                modelsHtml += displayed.map(m => escapeHtml(m)).join('<br />');
                if (more > 0) {
                  modelsHtml += \`<br /><em>... and \${more} more</em>\`;
                }
                modelsList.innerHTML = modelsHtml;
                div.appendChild(modelsList);
              } else {
                const noModels = document.createElement('div');
                noModels.className = 'models-list';
                noModels.textContent = 'No models fetched yet. Click "Fetch Models" to load available models.';
                div.appendChild(noModels);
              }

              providersDiv.appendChild(div);
            }
            container.appendChild(providersDiv);

            // Feature Mappings Section
            const featuresDiv = document.createElement('div');
            featuresDiv.className = 'section';
            featuresDiv.innerHTML = '<div class="section-header"><span class="section-icon"></span><div class="section-title">Feature Configuration</div></div>';

            for (const f of Object.keys(cfg.features)) {
              const fm = cfg.features[f];
              const row = document.createElement('div');
              row.className = 'feature-row';

              const title = document.createElement('div');
              title.className = 'feature-name';
              title.textContent = f.charAt(0).toUpperCase() + f.slice(1);
              row.appendChild(title);

              const controls = document.createElement('div');
              controls.className = 'feature-controls';

              const providerSelect = document.createElement('select');
              for (const p of Object.keys(cfg.apis)) {
                const opt = document.createElement('option');
                opt.value = p;
                opt.textContent = p;
                if (fm.provider === p) opt.selected = true;
                providerSelect.appendChild(opt);
              }
              providerSelect.onchange = () => {
                fm.provider = providerSelect.value;
                fm.model = undefined;
                // refresh model dropdown
                const models = cfg.apis[fm.provider].models || [];
                modelSelect.innerHTML = '';
                const blank = document.createElement('option');
                blank.value = '';
                blank.textContent = '(select model)';
                modelSelect.appendChild(blank);
                for (const m of models) {
                  const opt = document.createElement('option');
                  opt.value = m;
                  opt.textContent = m;
                  modelSelect.appendChild(opt);
                }
              };
              controls.appendChild(providerSelect);

              const modelSelect = document.createElement('select');
              const providerModels = cfg.apis[fm.provider].models || [];
              const blank = document.createElement('option');
              blank.value = '';
              blank.textContent = '(select model)';
              modelSelect.appendChild(blank);
              for (const m of providerModels) {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                if (fm.model === m) opt.selected = true;
                modelSelect.appendChild(opt);
              }
              modelSelect.onchange = () => fm.model = modelSelect.value || undefined;
              controls.appendChild(modelSelect);
              row.appendChild(controls);
              featuresDiv.appendChild(row);
            }
            container.appendChild(featuresDiv);

            // Action Buttons
            const actions = document.createElement('div');
            actions.className = 'actions';

            const saveBtn = document.createElement('button');
            saveBtn.textContent = '💾 Save Configuration';
            saveBtn.className = 'primary';
            saveBtn.onclick = () => {
              saveBtn.disabled = true;
              console.log('Saving config');
              vscode.postMessage({ type: 'saveConfig', config: cfg });
              setTimeout(() => saveBtn.disabled = false, 1000);
            };
            actions.appendChild(saveBtn);

            container.appendChild(actions);
          }

          // initial load
          console.log('Requesting initial load');
          vscode.postMessage({ type: 'load' });
        </script>
      </body>
      </html>
    `;
  }
}