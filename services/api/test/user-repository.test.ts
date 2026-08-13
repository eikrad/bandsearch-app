import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createInMemoryUserRepository, createSqliteUserRepository } from "../src/auth/userRepository.js";

function memRepo() {
  return createInMemoryUserRepository();
}

function sqliteRepo() {
  const db = new Database(":memory:");
  return createSqliteUserRepository({ db });
}

function repo() {
  return memRepo();
}

test("countUsers returns 0 on empty repository", async () => {
  assert.equal(await repo().countUsers(), 0);
});

test("create stores a user and returns it", async () => {
  const r = repo();
  const user = await r.create({
    email: "alice@example.com",
    displayName: "Alice",
    passwordHash: "hash1",
    recoveryCodeHash: "rchash1",
  });
  assert.equal(user.email, "alice@example.com");
  assert.equal(user.displayName, "Alice");
  assert.ok(user.id);
  assert.ok(user.createdAt);
  assert.equal("passwordHash" in user, false);
  assert.equal("recoveryCodeHash" in user, false);
});

test("countUsers increments after create", async () => {
  const r = repo();
  await r.create({ email: "a@x.com", displayName: "A", passwordHash: "h", recoveryCodeHash: "r" });
  assert.equal(await r.countUsers(), 1);
});

test("findByEmail returns user for known email", async () => {
  const r = repo();
  await r.create({ email: "bob@example.com", displayName: "Bob", passwordHash: "h2", recoveryCodeHash: "r2" });
  const found = await r.findByEmail("bob@example.com");
  assert.ok(found, "user should be found");
  assert.equal(found.email, "bob@example.com");
  assert.equal(found.passwordHash, "h2");
  assert.equal(found.recoveryCodeHash, "r2");
});

test("findByEmail returns null for unknown email", async () => {
  assert.equal(await repo().findByEmail("nobody@x.com"), null);
});

test("findByEmail is case-insensitive", async () => {
  const r = repo();
  await r.create({ email: "Carol@Example.COM", displayName: "Carol", passwordHash: "h3", recoveryCodeHash: "r3" });
  const found = await r.findByEmail("carol@example.com");
  assert.ok(found);
  assert.equal(found.displayName, "Carol");
});

test("findById returns user for known id", async () => {
  const r = repo();
  const created = await r.create({ email: "d@x.com", displayName: "D", passwordHash: "h4", recoveryCodeHash: "r4" });
  const found = await r.findById(created.id);
  assert.ok(found, "user should be found");
  assert.equal(found.id, created.id);
});

test("findById returns null for unknown id", async () => {
  assert.equal(await repo().findById("nope"), null);
});

test("create rejects duplicate email", async () => {
  const r = repo();
  await r.create({ email: "dup@x.com", displayName: "Dup", passwordHash: "h", recoveryCodeHash: "r" });
  await assert.rejects(
    () => r.create({ email: "dup@x.com", displayName: "Dup2", passwordHash: "h2", recoveryCodeHash: "r2" }),
    /email already registered/i,
  );
});

test("updatePassword changes passwordHash and recoveryCodeHash", async () => {
  const r = repo();
  const user = await r.create({ email: "e@x.com", displayName: "E", passwordHash: "old", recoveryCodeHash: "oldr" });
  const result = await r.updatePassword(user.id, { passwordHash: "new", recoveryCodeHash: "newr" });
  assert.equal(result.ok, true);
  const found = await r.findByEmail("e@x.com");
  assert.ok(found, "user should be found");
  assert.equal(found.passwordHash, "new");
  assert.equal(found.recoveryCodeHash, "newr");
});

test("updatePassword returns not-found for unknown id", async () => {
  const result = await repo().updatePassword("ghost", { passwordHash: "x", recoveryCodeHash: "y" });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/i);
});

// SQLite implementation

test("sqlite: create and findByEmail round-trips correctly", async () => {
  const r = sqliteRepo();
  await r.create({ email: "sqlite@x.com", displayName: "SQLite", passwordHash: "sh", recoveryCodeHash: "sr" });
  const found = await r.findByEmail("sqlite@x.com");
  assert.ok(found, "user should be found");
  assert.equal(found.displayName, "SQLite");
  assert.equal(found.passwordHash, "sh");
});

test("sqlite: countUsers reflects creates", async () => {
  const r = sqliteRepo();
  assert.equal(await r.countUsers(), 0);
  await r.create({ email: "a@x.com", displayName: "A", passwordHash: "h", recoveryCodeHash: "r" });
  assert.equal(await r.countUsers(), 1);
});

test("sqlite: rejects duplicate email", async () => {
  const r = sqliteRepo();
  await r.create({ email: "dup@x.com", displayName: "D", passwordHash: "h", recoveryCodeHash: "r" });
  await assert.rejects(
    () => r.create({ email: "dup@x.com", displayName: "D2", passwordHash: "h2", recoveryCodeHash: "r2" }),
    /email already registered/i,
  );
});

test("sqlite: updatePassword persists change", async () => {
  const r = sqliteRepo();
  const user = await r.create({ email: "up@x.com", displayName: "U", passwordHash: "old", recoveryCodeHash: "oldr" });
  await r.updatePassword(user.id, { passwordHash: "new", recoveryCodeHash: "newr" });
  const found = await r.findByEmail("up@x.com");
  assert.ok(found, "user should be found");
  assert.equal(found.passwordHash, "new");
});
