const { randomUUID } = require("crypto");

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function createInMemoryUserRepository() {
  const users = new Map();

  return {
    async countUsers() {
      return users.size;
    },

    async create({ email, displayName, passwordHash, recoveryCodeHash }) {
      const key = normalizeEmail(email);
      if (users.has(key)) throw new Error("email already registered");
      const user = {
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
  };
}

function createSqliteUserRepository({ db }) {
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
      return Promise.resolve(db.prepare("SELECT COUNT(*) as n FROM users").get().n);
    },

    create({ email, displayName, passwordHash, recoveryCodeHash }) {
      const id = randomUUID();
      const normalizedEmail = normalizeEmail(email);
      const createdAt = new Date().toISOString();
      try {
        db.prepare(
          "INSERT INTO users (id, email, display_name, password_hash, recovery_code_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, normalizedEmail, displayName, passwordHash, recoveryCodeHash, createdAt);
      } catch (err) {
        if (err.message?.includes("UNIQUE constraint failed"))
          return Promise.reject(new Error("email already registered"));
        return Promise.reject(err);
      }
      return Promise.resolve(publicUser({ id, email: normalizedEmail, displayName, passwordHash, recoveryCodeHash, createdAt }));
    },

    findByEmail(email) {
      const row = db.prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email));
      return Promise.resolve(row ? rowToUser(row) : null);
    },

    findById(id) {
      const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      return Promise.resolve(row ? rowToUser(row) : null);
    },

    updatePassword(id, { passwordHash, recoveryCodeHash }) {
      const result = db
        .prepare("UPDATE users SET password_hash = ?, recovery_code_hash = ? WHERE id = ?")
        .run(passwordHash, recoveryCodeHash, id);
      if (result.changes === 0) return Promise.resolve({ ok: false, error: "user not found" });
      return Promise.resolve({ ok: true });
    },
  };
}

function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    recoveryCodeHash: row.recovery_code_hash,
    createdAt: row.created_at,
  };
}

function publicUser(user) {
  // eslint-disable-next-line no-unused-vars
  const { passwordHash, recoveryCodeHash, ...pub } = user;
  return pub;
}

module.exports = { createInMemoryUserRepository, createSqliteUserRepository };
