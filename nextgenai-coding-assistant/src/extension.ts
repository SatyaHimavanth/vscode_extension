// src/extension.ts
import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { ChatViewProvider } from './chatView';
import { SettingsPanel } from './settingsPanel';
import { InlineCompletionProvider } from './inlineProvider';
import { ChatStorage } from './chatStorage';
import { CodebaseIndexer } from './codebaseIndexer';
import { IndexStorage } from './indexStorage';
import { FileWatcherIndexer } from './fileWatcherIndexer';

let indexer: CodebaseIndexer;
let indexStorage: IndexStorage;
let fileWatcher: FileWatcherIndexer;
let chatProvider: ChatViewProvider;

export async function activate(context: vscode.ExtensionContext) {
  console.log('NextGenAI extension activated');

  const cfgManager = new ConfigManager(context);
  const baseUrl = vscode.workspace.getConfiguration('nextgenai').get('baseUrl') as string || 'http://localhost:8000';

  // Initialize indexer and storage
  indexer = new CodebaseIndexer();
  indexStorage = new IndexStorage(context);

  // Initialize chat storage (SQLite database)
  const chatStorage = new ChatStorage(context);
  try {
    await chatStorage.initialize();
    console.log('Chat database initialized');
  } catch (error) {
    console.error('Failed to initialize chat database:', error);
    vscode.window.showErrorMessage('Failed to initialize chat database');
  }

  // Initialize file watcher with callback
  fileWatcher = new FileWatcherIndexer(indexer, indexStorage);

  // Register Chat View with database and indexer support
  chatProvider = new ChatViewProvider(
    context.extensionUri,
    cfgManager,
    baseUrl,
    chatStorage,
    indexer,
    indexStorage
  );
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('nextgenai.chatView', chatProvider));

  // Start file watching
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    fileWatcher.startWatching(
      workspaceFolder.uri.fsPath,
      (index) => {
        // Callback when auto-reindex completes
        console.log('Auto-reindex completed, notifying chat view');
        chatProvider.notifyIndexUpdate(index);
      }
    );
  }

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

  // Toggle inline suggestions
  context.subscriptions.push(vscode.commands.registerCommand('nextgenai.toggleInline', async () => {
    const current = vscode.workspace.getConfiguration('nextgenai').get('enableInline', true) as boolean;
    await vscode.workspace.getConfiguration('nextgenai').update('enableInline', !current, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`NextGenAI inline suggestions ${!current ? 'enabled' : 'disabled'}.`);
  }));

  // Index workspace command (manual trigger)
  context.subscriptions.push(
    vscode.commands.registerCommand('nextgenai.indexWorkspace', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      try {
        const index = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Indexing Codebase',
            cancellable: false
          },
          async (progress) => {
            return await indexer.indexWorkspace(workspaceFolder.uri.fsPath, progress);
          }
        );

        await indexStorage.saveIndex(workspaceFolder.uri.fsPath, index);

        // Update file watcher with new index
        fileWatcher.setCurrentIndex(index);

        const summary = indexer.getIndexSummary(index);
        vscode.window.showInformationMessage(`✓ Codebase indexed!\n${summary}`);

        // Notify chat view about index completion
        chatProvider.notifyIndexComplete(index);
      } catch (error) {
        console.error('Indexing error:', error);
        vscode.window.showErrorMessage(`Error indexing workspace: ${error}`);
      }
    })
  );

  // Clear index command
  context.subscriptions.push(
    vscode.commands.registerCommand('nextgenai.clearIndex', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      await indexStorage.deleteIndex(workspaceFolder.uri.fsPath);
      fileWatcher.setCurrentIndex(null as any);
      vscode.window.showInformationMessage('✓ Index cleared and auto-watch resumed');
    })
  );

  // Check index status command
  context.subscriptions.push(
    vscode.commands.registerCommand('nextgenai.indexStatus', async () => {
      const status = fileWatcher.getStatus();
      const watchStatus = status.isWatching ? '✓ Active' : '✗ Inactive';
      const indexStatus = status.isIndexing ? '🔄 Indexing...' : '✓ Idle';
      const lastIndexed = status.lastIndexed ? status.lastIndexed.toLocaleString() : 'Never';

      vscode.window.showInformationMessage(
        `NextGenAI Index Status\n\nFile Watching: ${watchStatus}\nIndexing: ${indexStatus}\nIndexed Files: ${status.indexedFiles}\nLast Indexed: ${lastIndexed}\nPending Changes: ${status.hasPendingChanges ? 'Yes' : 'No'}`
      );
    })
  );

  // Toggle auto-indexing
  context.subscriptions.push(
    vscode.commands.registerCommand('nextgenai.toggleAutoIndex', async () => {
      const status = fileWatcher.getStatus();
      
      if (status.isWatching) {
        fileWatcher.stopWatching();
        vscode.window.showInformationMessage('✓ Auto-indexing disabled');
      } else {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          fileWatcher.startWatching(
            workspaceFolder.uri.fsPath,
            (index) => {
              chatProvider.notifyIndexUpdate(index);
            }
          );
          vscode.window.showInformationMessage('✓ Auto-indexing enabled');
        }
      }
    })
  );

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: async () => {
      await chatStorage.close();
      fileWatcher.stopWatching();
    }
  });

  console.log('NextGenAI extension fully initialized');
}

export function deactivate() {
  console.log('NextGenAI extension deactivated');
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}