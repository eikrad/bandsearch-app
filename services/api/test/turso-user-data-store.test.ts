import test from "node:test";
import assert from "node:assert/strict";
import type { TursoClient, TursoStatement, TursoResult } from "../src/turso/tursoClient.js";
import { createTursoUserDataStore } from "../src/privacy/tursoUserDataStore.js";
import { USER_SCOPED_TABLES } from "../src/privacy/userDataStore.js";

type Recorded = { statements: TursoStatement[]; mode?: string };

function mockClient(rowsFor: (sql: string) => Record<string, unknown>[] = () => []) {
  const batches: Recorded[] = [];
  const executed: TursoStatement[] = [];
  const client: TursoClient = {
    async execute(statement) {
      const stmt: TursoStatement = typeof statement === "string" ? { sql: statement } : statement;
      executed.push(stmt);
      return { rows: rowsFor(stmt.sql), rowsAffected: 0 };
    },
    async batch(statements, mode) {
      batches.push({ statements, mode });
      return statements.map<TursoResult>(() => ({ rows: [], rowsAffected: 1 }));
    },
  };
  return { client, batches, executed };
}

test("erasure is sent to Turso as a single write batch", async () => {
  const { client, batches } = mockClient();
  const store = createTursoUserDataStore({ client });

  await store.eraseUserData("u-1");

  assert.equal(batches.length, 1, "erasure is one atomic batch, not a sequence of executes");
  assert.equal(batches[0].mode, "write", "the batch runs in write mode so it is transactional");
});

test("the Turso and SQLite backends erase the same set of tables", async () => {
  const { client, batches } = mockClient();
  const store = createTursoUserDataStore({ client });

  await store.eraseUserData("u-1");

  const sent = batches[0].statements.map((s) => s.sql);
  for (const { table } of USER_SCOPED_TABLES) {
    assert.ok(
      sent.some((sql) => sql.includes(`DELETE FROM ${table}`)),
      `${table} must be erased on Turso too, from the same shared table list`,
    );
  }
});

test("the users row is erased last so a failed run stays retryable", async () => {
  const { client, batches } = mockClient();
  const store = createTursoUserDataStore({ client });

  await store.eraseUserData("u-1");

  const sent = batches[0].statements.map((s) => s.sql);
  assert.match(sent[sent.length - 1], /DELETE FROM users/, "users is the final statement");
});

test("exporting a user from Turso never selects the password hash columns", async () => {
  const { client, executed } = mockClient((sql) =>
    sql.includes("FROM users")
      ? [{ id: "u-1", email: "one@example.com", display_name: "One", created_at: "2026-01-01T00:00:00.000Z" }]
      : [],
  );
  const store = createTursoUserDataStore({ client });

  const bundle = await store.exportUserData("u-1");

  assert.equal(bundle.user?.id, "u-1");
  const userQuery = executed.find((s) => s.sql.includes("FROM users"));
  assert.ok(userQuery, "a user query was issued");
  assert.equal(userQuery.sql.includes("*"), false, "columns are listed explicitly, never SELECT *");
  assert.equal(userQuery.sql.includes("password_hash"), false);
  assert.equal(userQuery.sql.includes("recovery_code_hash"), false);
});
