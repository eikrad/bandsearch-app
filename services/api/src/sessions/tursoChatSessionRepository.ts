import { randomUUID } from "node:crypto";
import type { Client as LibSQLClient } from "@libsql/client";

const DEFAULT_USER = "anonymous";
const DEFAULT_TITLE = "Untitled";

export function createTursoChatSessionRepository({ client }: { client: LibSQLClient }) {
  return {
    async createSession({ title = DEFAULT_TITLE } = {}, userId = DEFAULT_USER) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const result = await client.execute({
        sql: `INSERT INTO chat_sessions (id, title, user_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              RETURNING *`,
        args: [id, title, userId, now, now],
      });
      return result.rows[0];
    },

    async listSessions(userId = DEFAULT_USER) {
      const result = await client.execute({
        sql: "SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC",
        args: [userId],
      });
      return result.rows;
    },

    async getSession(id: string, userId = DEFAULT_USER) {
      const result = await client.execute({
        sql: "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?",
        args: [id, userId],
      });
      return result.rows.length > 0 ? result.rows[0] : null;
    },

    async addMessage(sessionId: string, { role, content }: { role: string; content: string }) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const result = await client.execute({
        sql: `INSERT INTO chat_messages (id, session_id, role, content, created_at)
              VALUES (?, ?, ?, ?, ?)
              RETURNING *`,
        args: [id, sessionId, role, String(content), now],
      });
      await client.execute({
        sql: "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
        args: [now, sessionId],
      });
      return result.rows[0];
    },

    async getMessages(sessionId: string) {
      const result = await client.execute({
        sql: "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
        args: [sessionId],
      });
      return result.rows;
    },
  };
}
