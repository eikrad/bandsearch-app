import { randomUUID } from "node:crypto";
import type { Client as LibSQLClient } from "@libsql/client";
import type { UserRepository, User, PublicUser } from "./userRepository";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    passwordHash: row.password_hash as string,
    recoveryCodeHash: row.recovery_code_hash as string,
    createdAt: row.created_at as string,
  };
}

function publicUser(user: User): PublicUser {
  const { passwordHash: _ph, recoveryCodeHash: _rc, ...pub } = user;
  void _ph;
  void _rc;
  return pub;
}

export function createTursoUserRepository({ client }: { client: LibSQLClient }): UserRepository {
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
