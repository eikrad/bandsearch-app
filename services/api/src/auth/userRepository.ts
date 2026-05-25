import { randomUUID } from "crypto";

export type User = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  recoveryCodeHash: string;
  createdAt: string;
};

export type PublicUser = Omit<User, "passwordHash" | "recoveryCodeHash">;

export type CreateUserInput = {
  email: string;
  displayName: string;
  passwordHash: string;
  recoveryCodeHash: string;
};

export type UpdatePasswordInput = {
  passwordHash: string;
  recoveryCodeHash: string;
};

export type UserRepository = {
  countUsers(): Promise<number>;
  create(input: CreateUserInput): Promise<PublicUser>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  updatePassword(id: string, input: UpdatePasswordInput): Promise<{ ok: true } | { ok: false; error: string }>;
  getFirstUser(): Promise<User | null>;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(user: User): PublicUser {
  const { passwordHash: _ph, recoveryCodeHash: _rc, ...pub } = user;
  void _ph;
  void _rc;
  return pub;
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

export function createInMemoryUserRepository(): UserRepository {
  const users = new Map<string, User>();

  return {
    async countUsers() {
      return users.size;
    },

    async create({ email, displayName, passwordHash, recoveryCodeHash }) {
      const key = normalizeEmail(email);
      if (users.has(key)) throw new Error("email already registered");
      const user: User = {
        id: randomUUID(),
        email: key,
        displayName,
        passwordHash,
        recoveryCodeHash,
        createdAt: new Date().toISOString(),
      };
      users.set(key, user);
      return publicUser(user);
    },

    async findByEmail(email) {
      const user = users.get(normalizeEmail(email));
      return user ? { ...user } : null;
    },

    async findById(id) {
      for (const user of users.values()) {
        if (user.id === id) return { ...user };
      }
      return null;
    },

    async updatePassword(id, { passwordHash, recoveryCodeHash }) {
      for (const [key, user] of users.entries()) {
        if (user.id === id) {
          users.set(key, { ...user, passwordHash, recoveryCodeHash });
          return { ok: true };
        }
      }
      return { ok: false, error: "user not found" };
    },

    async getFirstUser() {
      const first = users.values().next().value;
      return first ? { ...first } : null;
    },
  };
}

export function createSqliteUserRepository({ db }: { db: import("better-sqlite3").Database }): UserRepository {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      recovery_code_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  return {
    countUsers() {
      return Promise.resolve((db.prepare("SELECT COUNT(*) as n FROM users").get() as { n: number }).n);
    },

    create({ email, displayName, passwordHash, recoveryCodeHash }) {
      const id = randomUUID();
      const normalizedEmail = normalizeEmail(email);
      const createdAt = new Date().toISOString();
      try {
        db.prepare(
          "INSERT INTO users (id, email, display_name, password_hash, recovery_code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, normalizedEmail, displayName, passwordHash, recoveryCodeHash, createdAt);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("UNIQUE constraint failed")) return Promise.reject(new Error("email already registered"));
        return Promise.reject(err);
      }
      return Promise.resolve(
        publicUser({ id, email: normalizedEmail, displayName, passwordHash, recoveryCodeHash, createdAt }),
      );
    },

    findByEmail(email) {
      const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as
        | Record<string, unknown>
        | undefined;
      return Promise.resolve(row ? rowToUser(row) : null);
    },

    findById(id) {
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      return Promise.resolve(row ? rowToUser(row) : null);
    },

    updatePassword(id, { passwordHash, recoveryCodeHash }) {
      const result = db
        .prepare("UPDATE users SET password_hash = ?, recovery_code_hash = ? WHERE id = ?")
        .run(passwordHash, recoveryCodeHash, id);
      if (result.changes === 0) return Promise.resolve({ ok: false, error: "user not found" });
      return Promise.resolve({ ok: true });
    },

    getFirstUser() {
      const row = db.prepare("SELECT * FROM users LIMIT 1").get() as Record<string, unknown> | undefined;
      return Promise.resolve(row ? rowToUser(row) : null);
    },
  };
}
