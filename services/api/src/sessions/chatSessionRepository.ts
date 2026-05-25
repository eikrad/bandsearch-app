import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

const DEFAULT_USER = "anonymous";

type Session = { id: string; userId: string; title: string; createdAt: string; updatedAt: string };
type Message = { id: string; sessionId: string; role: string; content: string; createdAt: string };

function withoutUserId({ userId: _uid, ...rest }: Session) {
  void _uid;
  return rest;
}

export function createInMemoryChatSessionRepository() {
  const sessions: Session[] = [];
  const messages: Message[] = [];

  return {
    async createSession({ title = "Untitled" } = {}, userId = DEFAULT_USER) {
      const now = new Date().toISOString();
      const session: Session = { id: randomUUID(), userId, title, createdAt: now, updatedAt: now };
      sessions.push(session);
      return withoutUserId(session);
    },
    async listSessions(userId = DEFAULT_USER) {
      return sessions
        .filter((s) => s.userId === userId)
        .map(withoutUserId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getSession(id: string, userId = DEFAULT_USER) {
      const s = sessions.find((s) => s.id === id && s.userId === userId);
      return s ? withoutUserId(s) : null;
    },
    async addMessage(sessionId: string, { role, content }: { role: string; content: string }) {
      const now = new Date().toISOString();
      const message: Message = { id: randomUUID(), sessionId, role, content, createdAt: now };
      messages.push(message);
      const session = sessions.find((s) => s.id === sessionId);
      if (session) session.updatedAt = now;
      return message;
    },
    async getMessages(sessionId: string) {
      return messages
        .filter((m) => m.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  };
}

type PragmaTableRow = { name: string };

function addColumnIfMissing(db: Database, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as PragmaTableRow[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

type SessionRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};

export function createSqliteChatSessionRepository({ db }: { db: Database }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'anonymous',
      title TEXT NOT NULL DEFAULT 'Untitled',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages (session_id);
  `);
  addColumnIfMissing(db, "chat_sessions", "user_id", "TEXT NOT NULL DEFAULT 'anonymous'");

  return {
    async createSession({ title = "Untitled" } = {}, userId = DEFAULT_USER) {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(id, userId, title, now, now);
      return db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) as SessionRow;
    },
    async listSessions(userId = DEFAULT_USER) {
      return db.prepare(`SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC`).all(userId) as SessionRow[];
    },
    async getSession(id: string, userId = DEFAULT_USER) {
      return (db.prepare(`SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?`).get(id, userId) as SessionRow | undefined) ?? null;
    },
    async addMessage(sessionId: string, { role, content }: { role: string; content: string }) {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(id, sessionId, role, String(content), now);
      db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);
      return db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id) as MessageRow;
    },
    async getMessages(sessionId: string) {
      return db.prepare(
        `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`,
      ).all(sessionId) as MessageRow[];
    },
  };
}
