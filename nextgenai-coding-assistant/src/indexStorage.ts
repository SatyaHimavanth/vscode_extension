// src/indexStorage.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CodebaseIndex, CodeFile } from './codebaseIndexer';

export class IndexStorage {
  private storagePath: string;

  constructor(extensionContext: vscode.ExtensionContext) {
    this.storagePath = path.join(extensionContext.globalStorageUri.fsPath, 'codebase-index');
    fs.mkdirSync(this.storagePath, { recursive: true });
  }

  async saveIndex(workspacePath: string, index: CodebaseIndex): Promise<void> {
    try {
      const workspaceName = this.getWorkspaceName(workspacePath);
      const indexFile = path.join(this.storagePath, `${workspaceName}.json`);

      // Store only essential data to reduce file size
      const compactIndex = {
        rootPath: index.rootPath,
        fileCount: index.fileCount,
        totalSize: index.totalSize,
        lastIndexed: index.lastIndexed,
        languages: index.languages,
        files: index.files.map((f) => ({
          id: f.id,
          path: f.path,
          relativePath: f.relativePath,
          language: f.language,
          size: f.size,
          hash: f.hash,
          // Content stored separately for large indexes
        }))
      };

      // Save metadata
      await fs.promises.writeFile(indexFile, JSON.stringify(compactIndex, null, 2), 'utf-8');

      // Save content separately in chunks
      await this.saveFileContents(workspaceName, index.files);

      console.log(`Index saved for workspace: ${workspaceName}`);
    } catch (error) {
      console.error('Error saving index:', error);
      throw error;
    }
  }

  async loadIndex(workspacePath: string): Promise<CodebaseIndex | null> {
    try {
      const workspaceName = this.getWorkspaceName(workspacePath);
      const indexFile = path.join(this.storagePath, `${workspaceName}.json`);

      if (!fs.existsSync(indexFile)) {
        return null;
      }

      const content = await fs.promises.readFile(indexFile, 'utf-8');
      const compactIndex = JSON.parse(content);

      // Load file contents
      const filesWithContent = await this.loadFileContents(workspaceName, compactIndex.files);

      const index: CodebaseIndex = {
        ...compactIndex,
        files: filesWithContent
      };

      console.log(`Index loaded for workspace: ${workspaceName}`);
      return index;
    } catch (error) {
      console.error('Error loading index:', error);
      return null;
    }
  }

  private async saveFileContents(workspaceName: string, files: CodeFile[]): Promise<void> {
    const contentsDir = path.join(this.storagePath, workspaceName, 'contents');
    fs.mkdirSync(contentsDir, { recursive: true });

    for (const file of files) {
      try {
        const fileName = `${file.id}.txt`;
        const filePath = path.join(contentsDir, fileName);
        await fs.promises.writeFile(filePath, file.content, 'utf-8');
      } catch (error) {
        console.error(`Error saving file content for ${file.relativePath}:`, error);
      }
    }
  }

  private async loadFileContents(workspaceName: string, files: any[]): Promise<CodeFile[]> {
    const contentsDir = path.join(this.storagePath, workspaceName, 'contents');

    const filesWithContent = await Promise.all(
      files.map(async (file) => {
        try {
          const fileName = `${file.id}.txt`;
          const filePath = path.join(contentsDir, fileName);
          const content = await fs.promises.readFile(filePath, 'utf-8');
          return { ...file, content };
        } catch (error) {
          console.error(`Error loading file content for ${file.relativePath}:`, error);
          return { ...file, content: '' };
        }
      })
    );

    return filesWithContent;
  }

  private getWorkspaceName(workspacePath: string): string {
    return path.basename(workspacePath).replace(/[^a-z0-9-]/gi, '_');
  }

  async deleteIndex(workspacePath: string): Promise<void> {
    try {
      const workspaceName = this.getWorkspaceName(workspacePath);
      const indexFile = path.join(this.storagePath, `${workspaceName}.json`);
      const contentsDir = path.join(this.storagePath, workspaceName);

      if (fs.existsSync(indexFile)) {
        await fs.promises.unlink(indexFile);
      }

      if (fs.existsSync(contentsDir)) {
        await fs.promises.rm(contentsDir, { recursive: true });
      }

      console.log(`Index deleted for workspace: ${workspaceName}`);
    } catch (error) {
      console.error('Error deleting index:', error);
    }
  }

  async getIndexMetadata(workspacePath: string): Promise<{ fileCount: number; totalSize: number; lastIndexed: number } | null> {
    try {
      const workspaceName = this.getWorkspaceName(workspacePath);
      const indexFile = path.join(this.storagePath, `${workspaceName}.json`);

      if (!fs.existsSync(indexFile)) {
        return null;
      }

      const content = await fs.promises.readFile(indexFile, 'utf-8');
      const index = JSON.parse(content);

      return {
        fileCount: index.fileCount,
        totalSize: index.totalSize,
        lastIndexed: index.lastIndexed
      };
    } catch (error) {
      console.error('Error getting index metadata:', error);
      return null;
    }
  }
}