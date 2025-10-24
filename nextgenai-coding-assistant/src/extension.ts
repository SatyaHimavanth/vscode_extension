// src/extension.ts
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { ChatViewProvider } from './chatView';
import { SettingsPanel } from './settingsPanel';
import { InlineCompletionProvider } from './inlineProvider';
import { ChatStorage } from './chatStorage';

export async function activate(context: vscode.ExtensionContext) {
  console.log('NextGenAI extension activated');

  const cfgManager = new ConfigManager(context);
  const baseUrl = vscode.workspace.getConfiguration('nextgenai').get('baseUrl') as string || 'http://localhost:8000';

  // Initialize chat storage (SQLite database)
  const chatStorage = new ChatStorage(context);
  try {
    await chatStorage.initialize();
    console.log('Chat database initialized');
  } catch (error) {
    console.error('Failed to initialize chat database:', error);
    vscode.window.showErrorMessage('Failed to initialize chat database');
  }

  // Register Chat View with database support
  const chatProvider = new ChatViewProvider(context.extensionUri, cfgManager, baseUrl, chatStorage);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('nextgenai.chatView', chatProvider));

  // Register settings command
  context.subscriptions.push(vscode.commands.registerCommand('nextgenai.openSettings', async () => {
    await SettingsPanel.createOrShow(context.extensionUri, context, cfgManager);
  }));

  // Register pin file command
  context.subscriptions.push(vscode.commands.registerCommand('nextgenai.pinFile', async () => {
    vscode.window.showInformationMessage('Use the chat view pin button to pin files.');
  }));

  // Register inline completion provider
  const inlineProvider = new InlineCompletionProvider(cfgManager, baseUrl);
  context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider));

  // Add a toggle command to enable/disable inline suggestions
  context.subscriptions.push(vscode.commands.registerCommand('nextgenai.toggleInline', async () => {
    const current = vscode.workspace.getConfiguration('nextgenai').get('enableInline', true) as boolean;
    await vscode.workspace.getConfiguration('nextgenai').update('enableInline', !current, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`NextGenAI inline suggestions ${!current ? 'enabled' : 'disabled'}.`);
  }));

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: async () => {
      await chatStorage.close();
    }
  });
}

export function deactivate() {
  console.log('NextGenAI extension deactivated');
}