// src/fileWatcherIndexer.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { CodebaseIndexer, CodebaseIndex } from './codebaseIndexer';
import { IndexStorage } from './indexStorage';

export class FileWatcherIndexer {
  private indexer: CodebaseIndexer;
  private indexStorage: IndexStorage;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceDelay = 5000; // 5 seconds
  private isIndexing = false;
  private pendingChanges = false;
  private currentIndex: CodebaseIndex | null = null;
  private onIndexComplete: ((index: CodebaseIndex) => void) | null = null;

  constructor(indexer: CodebaseIndexer, indexStorage: IndexStorage) {
    this.indexer = indexer;
    this.indexStorage = indexStorage;
  }

  /**
   * Start watching for file changes
   */
  startWatching(workspacePath: string, onIndexComplete?: (index: CodebaseIndex) => void): void {
    this.onIndexComplete = onIndexComplete || null;

    if (this.fileWatcher) {
      this.stopWatching();
    }

    console.log('🔍 Starting file watcher for:', workspacePath);

    // Watch all files in workspace
    const pattern = new vscode.RelativePattern(workspacePath, '**/*');
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);

    // Handle file creation
    this.fileWatcher.onDidCreate((uri) => {
      console.log('📄 File created:', uri.fsPath);
      this.onFileChanged();
    });

    // Handle file changes
    this.fileWatcher.onDidChange((uri) => {
      console.log('✏️ File changed:', uri.fsPath);
      this.onFileChanged();
    });

    // Handle file deletion
    this.fileWatcher.onDidDelete((uri) => {
      console.log('🗑️ File deleted:', uri.fsPath);
      this.onFileChanged();
    });

    console.log('✓ File watcher started');
  }

  /**
   * Stop watching for file changes
   */
  stopWatching(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
      console.log('✓ File watcher stopped');
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Called when file changes are detected
   */
  private onFileChanged(): void {
    // Mark that changes are pending
    this.pendingChanges = true;

    // Clear existing timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new timer - wait for changes to settle
    this.debounceTimer = setTimeout(() => {
      if (this.pendingChanges && !this.isIndexing) {
        console.log('⏱️ Changes settled, re-indexing...');
        this.reindexWorkspace();
      }
    }, this.debounceDelay);
  }

  /**
   * Perform incremental re-indexing
   */
  private async reindexWorkspace(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || !this.currentIndex) {
      return;
    }

    this.isIndexing = true;
    this.pendingChanges = false;

    try {
      console.log('🔄 Starting incremental re-index...');
      
      // Re-index the workspace
      const updatedIndex = await this.indexer.indexWorkspace(workspaceFolder.uri.fsPath);

      // Save updated index
      await this.indexStorage.saveIndex(workspaceFolder.uri.fsPath, updatedIndex);
      this.currentIndex = updatedIndex;

      console.log('✓ Re-index complete');
      console.log(`  Files: ${updatedIndex.fileCount}`);
      console.log(`  Size: ${this.formatBytes(updatedIndex.totalSize)}`);

      // Notify listeners
      if (this.onIndexComplete) {
        this.onIndexComplete(updatedIndex);
      }
    } catch (error) {
      console.error('Error during re-indexing:', error);
    } finally {
      this.isIndexing = false;

      // Check if more changes happened while indexing
      if (this.pendingChanges) {
        this.onFileChanged();
      }
    }
  }

  /**
   * Set current index (call after manual indexing)
   */
  setCurrentIndex(index: CodebaseIndex): void {
    this.currentIndex = index;
    console.log('✓ Current index updated');
  }

  /**
   * Get current index status
   */
  getStatus(): {
    isWatching: boolean;
    isIndexing: boolean;
    hasPendingChanges: boolean;
    indexedFiles: number;
    lastIndexed: Date | null;
  } {
    return {
      isWatching: this.fileWatcher !== null,
      isIndexing: this.isIndexing,
      hasPendingChanges: this.pendingChanges,
      indexedFiles: this.currentIndex?.fileCount || 0,
      lastIndexed: this.currentIndex ? new Date(this.currentIndex.lastIndexed) : null
    };
  }

  /**
   * Set debounce delay (for testing or custom configuration)
   */
  setDebounceDelay(delayMs: number): void {
    this.debounceDelay = delayMs;
    console.log(`✓ Debounce delay set to ${delayMs}ms`);
  }

  /**
   * Force re-index immediately
   */
  async forceReindex(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder open');
    }

    if (this.isIndexing) {
      console.log('⚠️ Re-indexing already in progress');
      return;
    }

    console.log('🔄 Force re-index requested');
    this.pendingChanges = false;
    await this.reindexWorkspace();
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}