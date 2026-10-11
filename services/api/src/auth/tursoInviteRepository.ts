import { randomUUID } from "node:crypto";
import type { TursoClient } from "../turso/tursoClient.js";
import { rowToInvite, type InviteRepository } from "./inviteRepository.js";
import { normalizeEmail } from "./userModel.js";

export function createTursoInviteRepository({ client }: { client: TursoClient }): InviteRepository {
  return {
    async create({ email, codeHash, expiresAt }) {
      const result = await client.execute({
        sql: `INSERT INTO invites (id, email, code_hash, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?)
              RETURNING *`,
        args: [randomUUID(), normalizeEmail(email), codeHash, new Date().toISOString(), expiresAt],
      });
      return rowToInvite(result.rows[0]);
    },

    async findByCodeHash(codeHash) {
      const result = await client.execute({ sql: "SELECT * FROM invites WHERE code_hash = ?", args: [codeHash] });
      return result.rows.length > 0 ? rowToInvite(result.rows[0]) : null;
    },

    async list() {
      const result = await client.execute({
        sql: "SELECT * FROM invites ORDER BY created_at DESC, rowid DESC",
        args: [],
      });
      return result.rows.map(rowToInvite);
    },

    async markUsed(id) {
      const result = await client.execute({
        sql: "UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL",
        args: [new Date().toISOString(), id],
      });
      return result.rowsAffected > 0;
    },

    async revokeByEmail(email) {
      const result = await client.execute({
        sql: "UPDATE invites SET revoked_at = ? WHERE email = ? AND used_at IS NULL AND revoked_at IS NULL",
        args: [new Date().toISOString(), normalizeEmail(email)],
      });
      return result.rowsAffected;
    },
  };
}
