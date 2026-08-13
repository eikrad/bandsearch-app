import test from "node:test";
import assert from "node:assert/strict";
import type { Client as LibSQLClient } from "@libsql/client";
import { createTursoUserRepository as createRepository } from "../src/auth/tursoUserRepository.js";
import { assertRecord } from "./helpers/typeAssertions.js";

function assertRepositoryClient(client: unknown): asserts client is LibSQLClient {
  assertRecord(client);
  assert.ok(typeof client.execute === "function", "client.execute must be a function");
}

function createTursoUserRepository(options: { client: unknown }) {
  assertRepositoryClient(options.client);
  return createRepository({ client: options.client });
}

function makeUserRow(overrides = {}) {
  return {
    id: "u-1",
    email: "alice@x.com",
    display_name: "Alice",
    password_hash: "hashed",
    recovery_code_hash: "rchash",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

type ExecutedStatement = { sql: string; args?: unknown[] };

function mockClient(rows: Record<string, unknown>[] = [], rowsAffected = 1) {
  const calls: ExecutedStatement[] = [];
  return {
    calls,
    client: {
      execute: async (stmt: ExecutedStatement) => {
        calls.push(stmt);
        return { rows, rowsAffected };
      },
    },
  };
}

test("turso user repository: create calls INSERT and returns public user", async () => {
  const { calls, client } = mockClient([makeUserRow()]);
  const repo = createTursoUserRepository({ client });
  const user = await repo.create({
    email: "alice@x.com",
    displayName: "Alice",
    passwordHash: "hashed",
    recoveryCodeHash: "rchash",
  });
  assert.ok(calls.some((c) => c.sql.toUpperCase().includes("INSERT")));
  assert.equal(user.email, "alice@x.com");
  assert.equal("passwordHash" in user, false);
  assert.equal("recoveryCodeHash" in user, false);
});

test("turso user repository: findByEmail returns mapped user with hashes", async () => {
  const { client } = mockClient([makeUserRow()]);
  const repo = createTursoUserRepository({ client });
  const user = await repo.findByEmail("alice@x.com");
  assert.ok(user, "findByEmail should return the row");
  assert.equal(user.email, "alice@x.com");
  assert.equal(user.passwordHash, "hashed");
  assert.equal(user.recoveryCodeHash, "rchash");
});

test("turso user repository: findByEmail returns null when no rows", async () => {
  const { client } = mockClient([]);
  const repo = createTursoUserRepository({ client });
  const user = await repo.findByEmail("nobody@x.com");
  assert.equal(user, null);
});

test("turso user repository: findById returns mapped user", async () => {
  const { client } = mockClient([makeUserRow()]);
  const repo = createTursoUserRepository({ client });
  const user = await repo.findById("u-1");
  assert.ok(user, "findById should return the row");
  assert.equal(user.id, "u-1");
  assert.equal(user.displayName, "Alice");
});

test("turso user repository: findById returns null when no rows", async () => {
  const { client } = mockClient([]);
  const repo = createTursoUserRepository({ client });
  assert.equal(await repo.findById("nope"), null);
});

test("turso user repository: countUsers returns row count", async () => {
  const { client } = mockClient([{ n: 3 }]);
  const repo = createTursoUserRepository({ client });
  assert.equal(await repo.countUsers(), 3);
});

test("turso user repository: getFirstUser returns first row or null", async () => {
  const { client: c1 } = mockClient([makeUserRow()]);
  const r1 = createTursoUserRepository({ client: c1 });
  const user = await r1.getFirstUser();
  assert.ok(user, "getFirstUser should return the row");
  assert.equal(user.email, "alice@x.com");

  const { client: c2 } = mockClient([]);
  const r2 = createTursoUserRepository({ client: c2 });
  assert.equal(await r2.getFirstUser(), null);
});

test("turso user repository: updatePassword returns ok true on success", async () => {
  const { client } = mockClient([], 1);
  const repo = createTursoUserRepository({ client });
  const result = await repo.updatePassword("u-1", { passwordHash: "new", recoveryCodeHash: "newr" });
  assert.equal(result.ok, true);
});

test("turso user repository: updatePassword returns ok false when no rows affected", async () => {
  const { client } = mockClient([], 0);
  const repo = createTursoUserRepository({ client });
  const result = await repo.updatePassword("ghost", { passwordHash: "x", recoveryCodeHash: "y" });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/i);
});
