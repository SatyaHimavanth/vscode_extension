// src/chatStorage.ts
import * as sqlite3 from 'sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export type ChatMessage = {
  id?: number;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
};

export class ChatStorage {
  private db: sqlite3.Database | null = null;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(extensionContext: vscode.ExtensionContext) {
    this.dbPath = path.join(extensionContext.globalStorageUri.fsPath, 'chats.db');
    // Ensure directory exists
    fs.mkdirSync(extensionContext.globalStorageUri.fsPath, { recursive: true });
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      sqlite3.verbose();
      this.db = new sqlite3.Database(this.dbPath, async (err) => {
        if (err) {
          console.error('Failed to open database:', err);
          reject(err);
        } else {
          console.log('Database opened:', this.dbPath);
          try {
            await this.createTables();
            this.initialized = true;
            console.log('Database tables created successfully');
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      });
    });
  }

  private async createTables(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.serialize(() => {
        // Conversations table
        this.db!.run(
          `CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
          )`,
          (err) => {
            if (err) {
              console.error('Error creating conversations table:', err);
              reject(err);
            }
          }
        );

        // Messages table
        this.db!.run(
          `CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversationId TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
          )`,
          (err) => {
            if (err) {
              console.error('Error creating messages table:', err);
              reject(err);
            } else {
              console.log('Tables created or already exist');
              resolve();
            }
          }
        );
      });
    });
  }

  async addMessage(conversationId: string, role: 'user' | 'assistant', content: string): Promise<ChatMessage> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const timestamp = Date.now();
      this.db.run(
        'INSERT INTO messages (conversationId, role, content, timestamp) VALUES (?, ?, ?, ?)',
        [conversationId, role, content, timestamp],
        function (err) {
          if (err) {
            console.error('Error adding message:', err);
            reject(err);
          } else {
            console.log('Message added:', { id: this.lastID, role, content: content.substring(0, 50) });
            resolve({
              id: this.lastID,
              conversationId,
              role,
              content,
              timestamp
            });
          }
        }
      );
    });
  }

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.all(
        'SELECT id, conversationId, role, content, timestamp FROM messages WHERE conversationId = ? ORDER BY timestamp ASC',
        [conversationId],
        (err, rows: ChatMessage[]) => {
          if (err) {
            console.error('Error getting messages:', err);
            reject(err);
          } else {
            console.log('Retrieved messages:', rows?.length || 0);
            resolve(rows || []);
          }
        }
      );
    });
  }

  async createConversation(title: string = 'New Conversation'): Promise<Conversation> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const id = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const now = Date.now();

      this.db.run(
        'INSERT INTO conversations (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
        [id, title, now, now],
        (err) => {
          if (err) {
            console.error('Error creating conversation:', err);
            reject(err);
          } else {
            console.log('Conversation created:', id, title);
            resolve({
              id,
              title,
              createdAt: now,
              updatedAt: now,
              messageCount: 0
            });
          }
        }
      );
    });
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const now = Date.now();
      this.db.run(
        'UPDATE conversations SET title = ?, updatedAt = ? WHERE id = ?',
        [title, now, conversationId],
        (err) => {
          if (err) {
            console.error('Error updating conversation title:', err);
            reject(err);
          } else {
            console.log('Conversation title updated:', title);
            resolve();
          }
        }
      );
    });
  }

  async getAllConversations(): Promise<Conversation[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.all(
        `SELECT c.id, c.title, c.createdAt, c.updatedAt, COUNT(m.id) as messageCount
         FROM conversations c
         LEFT JOIN messages m ON c.id = m.conversationId
         GROUP BY c.id
         ORDER BY c.updatedAt DESC`,
        (err, rows: any[]) => {
          if (err) {
            console.error('Error getting conversations:', err);
            reject(err);
          } else {
            const conversations = (rows || []).map((row) => ({
              id: row.id,
              title: row.title,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              messageCount: row.messageCount || 0
            }));
            console.log('Retrieved conversations:', conversations.length);
            resolve(conversations);
          }
        }
      );
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.run('DELETE FROM conversations WHERE id = ?', [conversationId], (err) => {
        if (err) {
          console.error('Error deleting conversation:', err);
          reject(err);
        } else {
          console.log('Conversation deleted:', conversationId);
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
            reject(err);
          } else {
            this.db = null;
            console.log('Database closed');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}