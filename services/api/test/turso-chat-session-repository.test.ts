import { test } from "node:test";
import assert from "node:assert/strict";
import type { Client as LibSQLClient, ResultSet } from "@libsql/client";
import { createTursoChatSessionRepository } from "../src/sessions/tursoChatSessionRepository.js";

type MockExecute = (stmt: { sql: string; args?: unknown[] }) => Promise<{ rows: unknown[]; rowsAffected: number }>;

function makeMockClient(execute: MockExecute): LibSQLClient {
  return {
    execute,
    batch: async (stmts: { sql: string; args?: unknown[] }[]) => {
      const results: ResultSet[] = [];
      for (const stmt of stmts) {
        results.push((await execute(stmt)) as unknown as ResultSet);
      }
      return results;
    },
  } as unknown as LibSQLClient;
}

function makeSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    user_id: "user-a",
    title: "Test session",
    created_at: "2026-01-01T10:00:00.000Z",
    updated_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    session_id: "sess-1",
    role: "user",
    content: "I like atmospheric black metal",
    created_at: "2026-01-01T10:01:00.000Z",
    ...overrides,
  };
}

test("turso session repository: createSession inserts and returns row", async () => {
  const row = makeSessionRow({ title: "New session" });
  const calls: unknown[] = [];
  const repo = createTursoChatSessionRepository({
    client: makeMockClient(async (stmt) => {
      calls.push(stmt);
      return { rows: [row], rowsAffected: 1 };
    }),
  });

  const result = await repo.createSession({ title: "New session" }, "user-a");

  assert.equal(result.id, "sess-1");
  assert.equal(result.title, "New session");
  assert.ok(result.created_at, "created_at must be set");
  assert.equal(calls.length, 1);
  assert.ok((calls[0] as { sql: string }).sql.includes("INSERT INTO chat_sessions"), "must issue INSERT");
});

test("turso session repository: createSession uses default title and user", async () => {
  const calls: { sql: string; args: unknown[] }[] = [];
  const repo = createTursoChatSessionRepository({
    client: makeMockClient(async (stmt) => {
      calls.push(stmt as { sql: string; args: unknown[] });
      return { rows: [makeSessionRow()], rowsAffected: 1 };
    }),
  });

  await repo.createSession();

  const args = calls[0].args;
  assert.equal(args[1], "Untitled");
  assert.equal(args[2], "anonymous");
});

test("turso session repository: listSessions queries by userId", async () => {
  const rows = [makeSessionRow({ id: "s-1", title: "A" }), makeSessionRow({ id: "s-2", title: "B" })];
  const calls: { sql: string; args: unknown[] }[] = [];
  const repo = createTursoChatSessionRepository({
    client: makeMockClient(async (stmt) => {
      calls.push(stmt as { sql: string; args: unknown[] });
      return { rows, rowsAffected: 0 };
    }),
  });

  const result = await repo.listSessions("user-a");

  assert.equal(result.length, 2);
  assert.ok(calls[0].sql.includes("SELECT"), "must issue SELECT");
  assert.ok(calls[0].args.includes("user-a"), "must filter by userId");
});

test("turso session repository: getSession returns row when found", async () => {
  const row = makeSessionRow({ id: "sess-1" });
  const repo = createTursoChatSessionRepository({
    client: makeMockClient(async () => ({ rows: [row], rowsAffected: 0 })),
  });

  const result = await repo.getSession("sess-1", "user-a");
  assert.equal(result?.id, "sess-1");
});

test("turso session repository: getSession returns null when not found", async () => {
  const repo = createTursoChatSessionRepository({
    client: makeMockClient(async () => ({ rows: [], rowsAffected: 0 })),
  });

  const result = await repo.getSession("does-not-exist", "user-a");
  assert.equal(result, null);
});

test("turso session repository: getSession scopes by userId", async () => {
  const calls: { sql: string; args: unknown[] }[] = [];
  const repo = createTursoChatSessionRepository({
    client: makeMockClient(async (stmt) => {
      calls.push(stmt as { sql: string; args: unknown[] });
      return { rows: [], rowsAffected: 0 };
    }),
  });

  await repo.getSession("sess-1", "user-b");
  assert.ok(calls[0].args.includes("user-b"), "must include userId in query args");
});

test("turso session repository: addMessage batches insert + session update", async () => {
  const msgRow = makeMessageRow({ content: "I like Alcest" });
  const batchCalls: unknown[] = [];
  const client = {
    execute: async () => ({ rows: [], rowsAffected: 0 }),
    batch: async (stmts: unknown[]) => {
      batchCalls.push(stmts);
      return [{ rows: [msgRow], rowsAffected: 1 }, { rows: [], rowsAffected: 1 }];
    },
  } as unknown as LibSQLClient;
  const repo = createTursoChatSessionRepository({ client });

  const result = await repo.addMessage("sess-1", { role: "user", content: "I like Alcest" });

  assert.equal(result.id, "msg-1");
  assert.equal(result.role, "user");
  assert.equal(result.content, "I like Alcest");
  assert.ok(result.created_at, "created_at must be set");
  assert.equal(batchCalls.length, 1, "must use a single batch call");
  const stmts = batchCalls[0] as Array<{ sql: string }>;
  assert.ok(stmts[0].sql.includes("INSERT INTO chat_messages"), "first stmt must INSERT");
  assert.ok(stmts[1].sql.includes("UPDATE chat_sessions"), "second stmt must UPDATE session");
});

test("turso session repository: getMessages returns ordered rows", async () => {
  const rows = [
    makeMessageRow({ id: "m-1", created_at: "2026-01-01T10:00:00.000Z" }),
    makeMessageRow({ id: "m-2", created_at: "2026-01-01T10:01:00.000Z" }),
  ];
  const calls: { sql: string; args: unknown[] }[] = [];
  const repo = createTursoChatSessionRepository({
    client: makeMockClient(async (stmt) => {
      calls.push(stmt as { sql: string; args: unknown[] });
      return { rows, rowsAffected: 0 };
    }),
  });

  const result = await repo.getMessages("sess-1");
  assert.equal(result.length, 2);
  assert.ok(calls[0].sql.includes("SELECT"), "must issue SELECT");
  assert.ok(calls[0].args.includes("sess-1"), "must filter by sessionId");
});

test("turso session repository: listSessions scopes by user", async () => {
  const calls: { sql: string; args: unknown[] }[] = [];
  const repo = createTursoChatSessionRepository({
    client: makeMockClient(async (stmt) => {
      calls.push(stmt as { sql: string; args: unknown[] });
      return { rows: [], rowsAffected: 0 };
    }),
  });

  await repo.listSessions("user-c");
  assert.ok(calls[0].args.includes("user-c"), "must pass userId as filter arg");
});
