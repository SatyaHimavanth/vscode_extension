// src/configManager.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export type ProviderConfig = {
  base_url?: string;
  models?: string[];
  // NOTE: api_key stored in secret storage, not here
};

export type FeatureMapping = {
  provider: string;
  model?: string;
};

export type NextGenConfig = {
  apis: { [provider: string]: ProviderConfig };
  features: { [feature: string]: FeatureMapping };
};

const DEFAULT_CONFIG: NextGenConfig = {
  apis: {
    google: { base_url: "https://generativelanguage.googleapis.com/v1" },
    litellm: { base_url: "http://localhost:8000" }
  },
  features: {
    chat: { provider: "google", model: undefined },
    inline: { provider: "google", model: undefined },
    explain: { provider: "google", model: undefined }
  }
};

export class ConfigManager {
  private ctx: vscode.ExtensionContext;
  private configPath: string;
  private cache?: NextGenConfig;

  constructor(context: vscode.ExtensionContext) {
    this.ctx = context;
    this.configPath = path.join(this.ctx.globalStorageUri.fsPath, 'nextgen-config.json');
    // ensure folder exists
    fs.mkdirSync(this.ctx.globalStorageUri.fsPath, { recursive: true });
  }

  async loadConfig(): Promise<NextGenConfig> {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        this.cache = JSON.parse(raw) as NextGenConfig;
        return this.cache;
      } else {
        await this.saveConfig(DEFAULT_CONFIG);
        this.cache = DEFAULT_CONFIG;
        return this.cache;
      }
    } catch (err) {
      console.error("Failed to load config:", err);
      this.cache = DEFAULT_CONFIG;
      return this.cache;
    }
  }

  async saveConfig(cfg: NextGenConfig): Promise<void> {
    this.cache = cfg;
    fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), 'utf8');
  }

  // Secrets: store API keys in secret storage
  async getApiKey(provider: string): Promise<string | undefined> {
    const key = await this.ctx.secrets.get(`api.${provider}`);
    return key ?? undefined;
  }

  async setApiKey(provider: string, value: string | undefined): Promise<void> {
    if (!value) {
      await this.ctx.secrets.delete(`api.${provider}`);
    } else {
      await this.ctx.secrets.store(`api.${provider}`, value);
    }
  }
}
