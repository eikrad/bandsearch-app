const { randomUUID } = require("node:crypto");

function createInMemoryChatSessionRepository() {
  const sessions = [];
  const messages = [];

  return {
    async createSession({ title = "Untitled" } = {}) {
      const now = new Date().toISOString();
      const session = { id: randomUUID(), title, createdAt: now, updatedAt: now };
      sessions.push(session);
      return session;
    },
    async listSessions() {
      return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async getSession(id) {
      return sessions.find((s) => s.id === id) || null;
    },
    async addMessage(sessionId, { role, content }) {
      const now = new Date().toISOString();
      const message = { id: randomUUID(), sessionId, role, content, createdAt: now };
      messages.push(message);
      const session = sessions.find((s) => s.id === sessionId);
      if (session) session.updatedAt = now;
      return message;
    },
    async getMessages(sessionId) {
      return messages.filter((m) => m.sessionId === sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
  };
}

function createSqliteChatSessionRepository({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
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

  return {
    async createSession({ title = "Untitled" } = {}) {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ).run(id, title, now, now);
      return db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id);
    },
    async listSessions() {
      return db.prepare(`SELECT * FROM chat_sessions ORDER BY updated_at DESC`).all();
    },
    async getSession(id) {
      return db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) || null;
    },
    async addMessage(sessionId, { role, content }) {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(id, sessionId, role, String(content), now);
      db.prepare(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);
      return db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id);
    },
    async getMessages(sessionId) {
      return db.prepare(
        `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`,
      ).all(sessionId);
    },
  };
}

module.exports = { createInMemoryChatSessionRepository, createSqliteChatSessionRepository };
