// src/codebaseIndexer.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export type CodeFile = {
  id: string;
  path: string;
  relativePath: string;
  language: string;
  content: string;
  size: number;
  lastModified: number;
  hash: string;
  symbols?: string[]; // Function/class names
};

export type CodebaseIndex = {
  rootPath: string;
  files: CodeFile[];
  totalSize: number;
  fileCount: number;
  lastIndexed: number;
  languages: { [lang: string]: number };
  summary: {
    functions: number;
    classes: number;
    total: number;
  };
};

export class CodebaseIndexer {
  private gitignorePatterns: string[] = [];
  private commonIgnorePaths = [
    // Node.js
    'node_modules',
    '.npm',
    'npm-debug.log',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    
    // Python
    '__pycache__',
    '.venv',
    'venv',
    'env',
    '.env',
    '.env.local',
    '.env.*.local',
    'pip-log.txt',
    'pip-delete-this-directory.txt',
    '.Python',
    'build',
    'develop-eggs',
    'dist',
    'downloads',
    'eggs',
    '.eggs',
    'lib',
    'lib64',
    'parts',
    'sdist',
    'var',
    'wheels',
    '*.egg-info',
    '.installed.cfg',
    '*.egg',
    
    // Git & VCS
    '.git',
    '.gitignore',
    '.gitattributes',
    '.github',
    '.gitlab',
    '.hg',
    '.svn',
    
    // IDEs
    '.vscode',
    '.idea',
    '.sublime-project',
    '.sublime-workspace',
    '.project',
    '.pydevproject',
    '.settings',
    '.classpath',
    
    // Build & Dist
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    '.cache',
    '.parcel-cache',
    '.vercel',
    '.turbo',
    'coverage',
    
    // Java/Gradle
    '.gradle',
    'target',
    '.m2',
    
    // C/C++
    'cmake-build-debug',
    'cmake-build-release',
    '.o',
    '.a',
    '.so',
    
    // Go
    'vendor',
    '.gopath',
    
    // Rust
    'target',
    'Cargo.lock',
    
    // Docker
    '.dockerignore',
    'Dockerfile',
    
    // OS
    '.DS_Store',
    'Thumbs.db',
    '.AppleDouble',
    '.LSOverride',
    '.TemporaryItems',
    
    // Archives & Compressed
    '*.zip',
    '*.tar',
    '*.gz',
    '*.rar',
    
    // Other
    'tmp',
    'temp',
    '.tmp',
    'logs',
    '*.log',
    '.cache',
  ];

  private commonIgnoreFiles = [
    '.gitignore',
    '.env',
    '.env.local',
    '.DS_Store',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
  ];

  private supportedLanguages = new Set([
    'typescript',
    'javascript',
    'python',
    'java',
    'csharp',
    'cpp',
    'c',
    'go',
    'rust',
    'php',
    'ruby',
    'swift',
    'kotlin',
    'scala',
    'haskell',
    'r',
    'matlab',
    'groovy',
    'shell',
    'bash',
    'sql',
    'html',
    'css',
    'scss',
    'less',
    'json',
    'yaml',
    'xml',
    'markdown'
  ]);

  async indexWorkspace(
    workspacePath: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<CodebaseIndex> {
    const startTime = Date.now();
    const index: CodebaseIndex = {
      rootPath: workspacePath,
      files: [],
      totalSize: 0,
      fileCount: 0,
      lastIndexed: startTime,
      languages: {},
      summary: {
        functions: 0,
        classes: 0,
        total: 0
      }
    };

    try {
      // Load .gitignore patterns
      await this.loadGitignore(workspacePath);

      // Recursively scan directory
      await this.scanDirectory(workspacePath, workspacePath, index, progress);

      console.log(`✓ Indexing completed in ${Date.now() - startTime}ms`);
      console.log(`✓ Indexed ${index.fileCount} files, ${this.formatBytes(index.totalSize)}`);
      console.log(`✓ Languages:`, index.languages);

      return index;
    } catch (error) {
      console.error('Error indexing workspace:', error);
      throw error;
    }
  }

  private async scanDirectory(
    dirPath: string,
    rootPath: string,
    index: CodebaseIndex,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> {
    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(rootPath, fullPath);

        // Check if should ignore
        if (this.shouldIgnore(entry.name, relativePath, entry.isDirectory())) {
          continue;
        }

        if (entry.isDirectory()) {
          await this.scanDirectory(fullPath, rootPath, index, progress);
        } else if (entry.isFile()) {
          await this.indexFile(fullPath, relativePath, index, progress);
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }
  }

  private async indexFile(
    fullPath: string,
    relativePath: string,
    index: CodebaseIndex,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ): Promise<void> {
    try {
      const stats = await fs.promises.stat(fullPath);

      // Skip large files (>500KB)
      if (stats.size > 500 * 1024) {
        console.log(`⊘ Skipping large file: ${relativePath} (${this.formatBytes(stats.size)})`);
        return;
      }

      const language = this.getLanguageFromPath(fullPath);
      if (!language) {
        return; // Skip unsupported file types
      }

      const content = await fs.promises.readFile(fullPath, 'utf-8').catch(() => '');

      // Extract symbols (functions, classes, etc.)
      const symbols = this.extractSymbols(content, language);

      const file: CodeFile = {
        id: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        path: fullPath,
        relativePath,
        language,
        content,
        size: stats.size,
        lastModified: stats.mtimeMs,
        hash: this.simpleHash(content),
        symbols
      };

      index.files.push(file);
      index.totalSize += stats.size;
      index.fileCount++;
      index.languages[language] = (index.languages[language] || 0) + 1;
      index.summary.total += symbols.length;
      index.summary.functions += symbols.filter(s => s.startsWith('fn:') || s.startsWith('method:')).length;
      index.summary.classes += symbols.filter(s => s.startsWith('class:') || s.startsWith('struct:')).length;

      progress?.report({
        message: `Indexed: ${relativePath}`,
        increment: 1
      });
    } catch (error) {
      console.error(`Error indexing file ${fullPath}:`, error);
    }
  }

  private shouldIgnore(fileName: string, relativePath: string, isDir: boolean): boolean {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');

    // Check exact filename matches
    if (this.commonIgnoreFiles.includes(fileName)) {
      return true;
    }

    // Check against common ignore patterns
    for (const part of parts) {
      if (this.commonIgnorePaths.includes(part)) {
        console.log(`⊘ Ignoring: ${normalizedPath}`);
        return true;
      }
    }

    // Check against .gitignore patterns
    for (const pattern of this.gitignorePatterns) {
      if (this.matchesPattern(normalizedPath, pattern)) {
        return true;
      }
    }

    return false;
  }

  private matchesPattern(path: string, pattern: string): boolean {
    // Simple glob pattern matching
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');

    try {
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(path);
    } catch {
      return false;
    }
  }

  private async loadGitignore(workspacePath: string): Promise<void> {
    try {
      const gitignorePath = path.join(workspacePath, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        const content = await fs.promises.readFile(gitignorePath, 'utf-8');
        this.gitignorePatterns = content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'));
        console.log(`✓ Loaded .gitignore with ${this.gitignorePatterns.length} patterns`);
      }
    } catch (error) {
      console.error('Error loading .gitignore:', error);
    }
  }

  private extractSymbols(content: string, language: string): string[] {
    const symbols: string[] = [];
    
    if (language === 'typescript' || language === 'javascript') {
      // Extract functions
      const funcRegex = /(?:async\s+)?(?:function|const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:=\s*)?(?:async\s*)?\(/g;
      let match;
      while ((match = funcRegex.exec(content)) !== null) {
        symbols.push(`fn:${match[1]}`);
      }
      
      // Extract classes
      const classRegex = /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
      while ((match = classRegex.exec(content)) !== null) {
        symbols.push(`class:${match[1]}`);
      }
    } else if (language === 'python') {
      // Extract functions
      const funcRegex = /def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
      let match;
      while ((match = funcRegex.exec(content)) !== null) {
        symbols.push(`fn:${match[1]}`);
      }
      
      // Extract classes
      const classRegex = /class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
      while ((match = classRegex.exec(content)) !== null) {
        symbols.push(`class:${match[1]}`);
      }
    } else if (language === 'java' || language === 'csharp') {
      // Extract classes
      const classRegex = /(?:public\s+)?(?:class|interface)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let match;
      while ((match = classRegex.exec(content)) !== null) {
        symbols.push(`class:${match[1]}`);
      }
      
      // Extract methods
      const methodRegex = /(?:public|private|protected)?\s+(?:static\s+)?(?:\w+\s+)*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
      while ((match = methodRegex.exec(content)) !== null) {
        symbols.push(`method:${match[1]}`);
      }
    }

    return symbols;
  }

  private getLanguageFromPath(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase().substring(1);
    const extensionMap: { [key: string]: string } = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      cs: 'csharp',
      cpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      c: 'c',
      go: 'go',
      rs: 'rust',
      php: 'php',
      rb: 'ruby',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      hs: 'haskell',
      r: 'r',
      m: 'matlab',
      groovy: 'groovy',
      sh: 'shell',
      bash: 'bash',
      sql: 'sql',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      md: 'markdown'
    };

    const lang = extensionMap[ext];
    return lang && this.supportedLanguages.has(lang) ? lang : null;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  getIndexSummary(index: CodebaseIndex): string {
    const summary = Object.entries(index.languages)
      .sort((a, b) => b[1] - a[1])
      .map(([lang, count]) => `${lang}: ${count}`)
      .join(', ');

    return `
Codebase Index Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Files: ${index.fileCount}
Total Size: ${this.formatBytes(index.totalSize)}
Languages: ${summary}
Functions/Methods: ${index.summary.functions}
Classes/Structs: ${index.summary.classes}
Last Indexed: ${new Date(index.lastIndexed).toLocaleString()}
    `.trim();
  }

  // Search for files by name or content
  searchFiles(index: CodebaseIndex, query: string, limit: number = 10): CodeFile[] {
    const lowerQuery = query.toLowerCase();
    return index.files
      .filter(
        (file) =>
          file.relativePath.toLowerCase().includes(lowerQuery) ||
          file.content.toLowerCase().includes(lowerQuery) ||
          file.symbols?.some(s => s.toLowerCase().includes(lowerQuery))
      )
      .slice(0, limit);
  }

  // Get all files of a specific language
  getFilesByLanguage(index: CodebaseIndex, language: string): CodeFile[] {
    return index.files.filter((f) => f.language === language);
  }

  // Get file context for chat
  getFileContext(index: CodebaseIndex, filePath: string): string {
    const file = index.files.find((f) => f.relativePath === filePath || f.path === filePath);
    if (!file) return '';
    return file.content;
  }

  // Get all functions/classes for context
  getSymbols(index: CodebaseIndex): { [key: string]: string[] } {
    const result: { [key: string]: string[] } = {};
    index.files.forEach((file) => {
      if (file.symbols && file.symbols.length > 0) {
        result[file.relativePath] = file.symbols;
      }
    });
    return result;
  }
}