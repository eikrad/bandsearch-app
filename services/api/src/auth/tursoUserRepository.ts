import { randomUUID } from "node:crypto";
import type { TursoClient } from "../turso/tursoClient.js";
import type { UserRepository } from "./userRepository";
import { normalizeEmail, publicUser, rowToUser } from "./userModel.js";

export function createTursoUserRepository({ client }: { client: TursoClient }): UserRepository {
  return {
    async countUsers() {
      const result = await client.execute({ sql: "SELECT COUNT(*) as n FROM users", args: [] });
      return Number(result.rows[0].n);
    },

    async create({ email, displayName, passwordHash, recoveryCodeHash }) {
      const id = randomUUID();
      const normalizedEmail = normalizeEmail(email);
      const createdAt = new Date().toISOString();
      const result = await client.execute({
        sql: `INSERT INTO users (id, email, display_name, password_hash, recovery_code_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?)
              RETURNING *`,
        args: [id, normalizedEmail, displayName, passwordHash, recoveryCodeHash, createdAt],
      });
      return publicUser(rowToUser(result.rows[0]));
    },

    async findByEmail(email) {
      const result = await client.execute({
        sql: "SELECT * FROM users WHERE email = ?",
        args: [normalizeEmail(email)],
      });
      return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
    },

    async findById(id) {
      const result = await client.execute({
        sql: "SELECT * FROM users WHERE id = ?",
        args: [id],
      });
      return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
    },

    async updatePassword(id, { passwordHash, recoveryCodeHash }) {
      const result = await client.execute({
        sql: "UPDATE users SET password_hash = ?, recovery_code_hash = ? WHERE id = ?",
        args: [passwordHash, recoveryCodeHash, id],
      });
      if (result.rowsAffected === 0) return { ok: false, error: "user not found" };
      return { ok: true };
    },

    async getFirstUser() {
      const result = await client.execute({ sql: "SELECT * FROM users LIMIT 1", args: [] });
      return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
    },
  };
}
