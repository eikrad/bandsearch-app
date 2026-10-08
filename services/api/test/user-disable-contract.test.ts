import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  createInMemoryUserRepository,
  createSqliteUserRepository,
  type UserRepository,
} from "../src/auth/userRepository.js";
import { createTursoUserRepository } from "../src/auth/tursoUserRepository.js";
import { createMigratedAuthTestDb } from "./helpers/authTestDb.js";
import { createSqliteBackedTursoClient } from "./helpers/sqliteBackedTursoClient.js";

const NEW_USER = { email: "a@x.com", displayName: "A", passwordHash: "h", recoveryCodeHash: "r" };

function runDisableContract(adapter: string, makeRepo: () => UserRepository) {
  test(`[${adapter}] a new user is not disabled`, async () => {
    const repo = makeRepo();
    const { id } = await repo.create(NEW_USER);
    assert.equal((await repo.findById(id))?.disabledAt, null);
  });

  test(`[${adapter}] a disabled user is flagged until enabled again`, async () => {
    const repo = makeRepo();
    const { id } = await repo.create(NEW_USER);

    assert.equal(await repo.setDisabled(id, true), true);
    assert.ok((await repo.findById(id))?.disabledAt);
    assert.ok((await repo.findByEmail("a@x.com"))?.disabledAt);

    assert.equal(await repo.setDisabled(id, false), true);
    assert.equal((await repo.findById(id))?.disabledAt, null);
  });

  test(`[${adapter}] disabling an unknown user reports that nothing changed`, async () => {
    assert.equal(await makeRepo().setDisabled("missing", true), false);
  });

  test(`[${adapter}] the disabled flag is not part of the public user`, async () => {
    const user = await makeRepo().create(NEW_USER);
    assert.equal("disabledAt" in user, false);
  });
}

runDisableContract("memory", () => createInMemoryUserRepository());
runDisableContract("sqlite", () => createSqliteUserRepository({ db: new Database(":memory:") }));
runDisableContract("turso", () =>
  createTursoUserRepository({ client: createSqliteBackedTursoClient(createMigratedAuthTestDb()) }),
);

test("an existing SQLite database from before closed beta gains the disabled flag on startup", async () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL, recovery_code_hash TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
  db.prepare("INSERT INTO users VALUES ('u1','old@x.com','Old','h','r','2026-01-01T00:00:00.000Z')").run();

  const repo = createSqliteUserRepository({ db });

  assert.equal((await repo.findById("u1"))?.disabledAt, null);
  assert.equal(await repo.setDisabled("u1", true), true);
});
