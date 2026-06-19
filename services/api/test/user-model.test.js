const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeEmail, publicUser, rowToUser } = require("../src/auth/userModel");

test("normalizeEmail trims whitespace and lowercases", () => {
  assert.equal(normalizeEmail("  Alice@Example.COM  "), "alice@example.com");
});

test("normalizeEmail handles already-lowercase email", () => {
  assert.equal(normalizeEmail("alice@example.com"), "alice@example.com");
});

test("publicUser strips passwordHash and recoveryCodeHash fields", () => {
  const user = {
    id: "1",
    email: "alice@example.com",
    displayName: "Alice",
    passwordHash: "secret",
    recoveryCodeHash: "also-secret",
    createdAt: "2024-01-01T00:00:00.000Z",
  };
  const pub = publicUser(user);
  assert.equal("passwordHash" in pub, false);
  assert.equal("recoveryCodeHash" in pub, false);
});

test("publicUser preserves id, email, displayName, createdAt", () => {
  const user = {
    id: "42",
    email: "bob@example.com",
    displayName: "Bob",
    passwordHash: "hash",
    recoveryCodeHash: "rchash",
    createdAt: "2025-06-01T10:00:00.000Z",
  };
  const pub = publicUser(user);
  assert.equal(pub.id, "42");
  assert.equal(pub.email, "bob@example.com");
  assert.equal(pub.displayName, "Bob");
  assert.equal(pub.createdAt, "2025-06-01T10:00:00.000Z");
});

test("rowToUser maps snake_case DB row fields to camelCase User fields", () => {
  const row = {
    id: "abc",
    email: "carol@example.com",
    display_name: "Carol",
    password_hash: "phash",
    recovery_code_hash: "rchash",
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const user = rowToUser(row);
  assert.equal(user.id, "abc");
  assert.equal(user.email, "carol@example.com");
  assert.equal(user.displayName, "Carol");
  assert.equal(user.passwordHash, "phash");
  assert.equal(user.recoveryCodeHash, "rchash");
  assert.equal(user.createdAt, "2026-01-01T00:00:00.000Z");
});
