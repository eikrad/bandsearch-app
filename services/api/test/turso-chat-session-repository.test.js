const test = require("node:test");
const assert = require("node:assert/strict");

const { createTursoChatSessionRepository } = require("../src/sessions/tursoChatSessionRepository");

function makeSessionRow(overrides = {}) {
  return {
    id: "sess-1",
    user_id: "user-a",
    title: "Test session",
    created_at: "2026-01-01T10:00:00.000Z",
    updated_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeMessageRow(overrides = {}) {
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
  const calls = [];
  const repo = createTursoChatSessionRepository({
    client: {
      execute: async (stmt) => {
        calls.push(stmt);
        return { rows: [row], rowsAffected: 1 };
      },
    },
  });

  const result = await repo.createSession({ title: "New session" }, "user-a");

  assert.equal(result.id, "sess-1");
  assert.equal(result.title, "New session");
  assert.ok(result.created_at, "created_at must be set");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].sql.includes("INSERT INTO chat_sessions"), "must issue INSERT");
});

test("turso session repository: createSession uses default title and user", async () => {
  const calls = [];
  const repo = createTursoChatSessionRepository({
    client: {
      execute: async (stmt) => {
        calls.push(stmt);
        return { rows: [makeSessionRow()], rowsAffected: 1 };
      },
    },
  });

  await repo.createSession();

  const args = calls[0].args;
  assert.equal(args[1], "Untitled");
  assert.equal(args[2], "anonymous");
});

test("turso session repository: listSessions queries by userId", async () => {
  const rows = [
    makeSessionRow({ id: "s-1", title: "A" }),
    makeSessionRow({ id: "s-2", title: "B" }),
  ];
  const calls = [];
  const repo = createTursoChatSessionRepository({
    client: {
      execute: async (stmt) => {
        calls.push(stmt);
        return { rows, rowsAffected: 0 };
      },
    },
  });

  const result = await repo.listSessions("user-a");

  assert.equal(result.length, 2);
  assert.ok(calls[0].sql.includes("SELECT"), "must issue SELECT");
  assert.ok(calls[0].args.includes("user-a"), "must filter by userId");
});

test("turso session repository: getSession returns row when found", async () => {
  const row = makeSessionRow({ id: "sess-1" });
  const repo = createTursoChatSessionRepository({
    client: { execute: async () => ({ rows: [row], rowsAffected: 0 }) },
  });

  const result = await repo.getSession("sess-1", "user-a");

  assert.equal(result.id, "sess-1");
});

test("turso session repository: getSession returns null when not found", async () => {
  const repo = createTursoChatSessionRepository({
    client: { execute: async () => ({ rows: [], rowsAffected: 0 }) },
  });

  const result = await repo.getSession("does-not-exist", "user-a");

  assert.equal(result, null);
});

test("turso session repository: getSession scopes by userId", async () => {
  const calls = [];
  const repo = createTursoChatSessionRepository({
    client: {
      execute: async (stmt) => {
        calls.push(stmt);
        return { rows: [], rowsAffected: 0 };
      },
    },
  });

  await repo.getSession("sess-1", "user-b");

  assert.ok(calls[0].args.includes("user-b"), "must include userId in query args");
});

test("turso session repository: addMessage inserts message and updates session", async () => {
  const msgRow = makeMessageRow({ content: "I like Alcest" });
  let callCount = 0;
  const calls = [];
  const repo = createTursoChatSessionRepository({
    client: {
      execute: async (stmt) => {
        calls.push(stmt);
        callCount++;
        return { rows: callCount === 1 ? [msgRow] : [], rowsAffected: 1 };
      },
    },
  });

  const result = await repo.addMessage("sess-1", { role: "user", content: "I like Alcest" });

  assert.equal(result.id, "msg-1");
  assert.equal(result.role, "user");
  assert.equal(result.content, "I like Alcest");
  assert.ok(result.created_at, "created_at must be set");
  assert.equal(calls.length, 2, "must INSERT message and UPDATE session");
  assert.ok(calls[0].sql.includes("INSERT INTO chat_messages"), "first call must INSERT");
  assert.ok(calls[1].sql.includes("UPDATE chat_sessions"), "second call must UPDATE session timestamp");
});

test("turso session repository: getMessages returns ordered rows", async () => {
  const rows = [
    makeMessageRow({ id: "m-1", created_at: "2026-01-01T10:00:00.000Z" }),
    makeMessageRow({ id: "m-2", created_at: "2026-01-01T10:01:00.000Z" }),
  ];
  const calls = [];
  const repo = createTursoChatSessionRepository({
    client: {
      execute: async (stmt) => {
        calls.push(stmt);
        return { rows, rowsAffected: 0 };
      },
    },
  });

  const result = await repo.getMessages("sess-1");

  assert.equal(result.length, 2);
  assert.ok(calls[0].sql.includes("SELECT"), "must issue SELECT");
  assert.ok(calls[0].args.includes("sess-1"), "must filter by sessionId");
});

// --- User isolation ---

test("turso session repository: listSessions scopes by user", async () => {
  const calls = [];
  const repo = createTursoChatSessionRepository({
    client: {
      execute: async (stmt) => {
        calls.push(stmt);
        return { rows: [], rowsAffected: 0 };
      },
    },
  });

  await repo.listSessions("user-c");

  assert.ok(calls[0].args.includes("user-c"), "must pass userId as filter arg");
});
