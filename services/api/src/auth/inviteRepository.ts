import { randomUUID } from "node:crypto";
import { normalizeEmail } from "./userModel.js";

/**
 * An invitation to register, bound to one email address.
 *
 * Only the SHA-256 hash of the code is ever stored; the code itself exists in
 * the operator's terminal once, at creation.
 */
export type Invite = {
  id: string;
  /** Normalized (trimmed, lower-cased) address the invite is bound to. */
  email: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

export type CreateInviteInput = { email: string; codeHash: string; expiresAt: string };

export type InviteRepository = {
  /** Rejects when the code hash already exists. */
  create(input: CreateInviteInput): Promise<Invite>;
  findByCodeHash(codeHash: string): Promise<Invite | null>;
  /** Every invite, newest first. */
  list(): Promise<Invite[]>;
  /**
   * Marks an invite redeemed. Resolves true only for the one caller that
   * moves it from unused to used; false if it was already used, revoked or
   * does not exist. Expiry is the caller's concern (it needs a clock).
   */
  markUsed(id: string): Promise<boolean>;
  /** Withdraws the address's invites that are neither used nor revoked; resolves how many. */
  revokeByEmail(email: string): Promise<number>;
};

export function rowToInvite(row: Record<string, unknown>): Invite {
  return {
    id: row.id as string,
    email: row.email as string,
    codeHash: row.code_hash as string,
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    usedAt: (row.used_at as string | null | undefined) ?? null,
    revokedAt: (row.revoked_at as string | null | undefined) ?? null,
  };
}

export function createInMemoryInviteRepository(): InviteRepository {
  const invites = new Map<string, Invite>();

  return {
    async create({ email, codeHash, expiresAt }) {
      if ([...invites.values()].some((i) => i.codeHash === codeHash)) throw new Error("invite code already exists");
      const invite: Invite = {
        id: randomUUID(),
        email: normalizeEmail(email),
        codeHash,
        createdAt: new Date().toISOString(),
        expiresAt,
        usedAt: null,
        revokedAt: null,
      };
      invites.set(invite.id, invite);
      return { ...invite };
    },

    async findByCodeHash(codeHash) {
      const found = [...invites.values()].find((i) => i.codeHash === codeHash);
      return found ? { ...found } : null;
    },

    async list() {
      return [...invites.values()].reverse().map((i) => ({ ...i }));
    },

    async markUsed(id) {
      const invite = invites.get(id);
      if (!invite || invite.usedAt || invite.revokedAt) return false;
      invite.usedAt = new Date().toISOString();
      return true;
    },

    async revokeByEmail(email) {
      const key = normalizeEmail(email);
      let revoked = 0;
      for (const invite of invites.values()) {
        if (invite.email === key && !invite.usedAt && !invite.revokedAt) {
          invite.revokedAt = new Date().toISOString();
          revoked += 1;
        }
      }
      return revoked;
    },
  };
}

export function createSqliteInviteRepository({ db }: { db: import("better-sqlite3").Database }): InviteRepository {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_invites_email ON invites (email);
  `);

  return {
    create({ email, codeHash, expiresAt }) {
      const id = randomUUID();
      const normalizedEmail = normalizeEmail(email);
      const createdAt = new Date().toISOString();
      try {
        db.prepare(
          "INSERT INTO invites (id, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        ).run(id, normalizedEmail, codeHash, createdAt, expiresAt);
      } catch (err) {
        return Promise.reject(err);
      }
      return Promise.resolve({
        id,
        email: normalizedEmail,
        codeHash,
        createdAt,
        expiresAt,
        usedAt: null,
        revokedAt: null,
      });
    },

    findByCodeHash(codeHash) {
      const row = db.prepare("SELECT * FROM invites WHERE code_hash = ?").get(codeHash) as
        | Record<string, unknown>
        | undefined;
      return Promise.resolve(row ? rowToInvite(row) : null);
    },

    list() {
      const rows = db.prepare("SELECT * FROM invites ORDER BY created_at DESC, rowid DESC").all() as Record<
        string,
        unknown
      >[];
      return Promise.resolve(rows.map(rowToInvite));
    },

    markUsed(id) {
      const result = db
        .prepare("UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL")
        .run(new Date().toISOString(), id);
      return Promise.resolve(result.changes > 0);
    },

    revokeByEmail(email) {
      const result = db
        .prepare("UPDATE invites SET revoked_at = ? WHERE email = ? AND used_at IS NULL AND revoked_at IS NULL")
        .run(new Date().toISOString(), normalizeEmail(email));
      return Promise.resolve(result.changes);
    },
  };
}
