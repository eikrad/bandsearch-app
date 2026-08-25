import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTursoSyncClient } from "../src/turso/tursoSyncClient.js";

// `@tursodatabase/sync` opens a local-only database when no url is given, so
// the statement surface is exercised against a real engine rather than a fake.
// The sync policy itself (push after writes, tolerate being offline) needs a
// double, since that half is exactly what has no local equivalent.

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "turso-sync-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function localClient(dir: string) {
  const client = await createTursoSyncClient({ path: path.join(dir, "test.db") });
  await client.execute("CREATE TABLE bands (id TEXT PRIMARY KEY, name TEXT, rating INTEGER)");
  return client;
}

test("execute returns rows for a select", async () => {
  await withTempDir(async (dir) => {
    const client = await localClient(dir);
    await client.execute({ sql: "INSERT INTO bands VALUES (?, ?, ?)", args: ["b1", "Codeine", 5] });

    const result = await client.execute({ sql: "SELECT * FROM bands WHERE name = ?", args: ["Codeine"] });

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, "Codeine");
    await client.close();
  });
});

test("execute returns the inserted row for INSERT ... RETURNING", async () => {
  await withTempDir(async (dir) => {
    const client = await localClient(dir);

    const result = await client.execute({
      sql: "INSERT INTO bands VALUES (?, ?, ?) RETURNING *",
      args: ["b1", "Bedhead", 4],
    });

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, "Bedhead");
    await client.close();
  });
});

test("execute reports rowsAffected for a delete", async () => {
  await withTempDir(async (dir) => {
    const client = await localClient(dir);
    await client.execute({ sql: "INSERT INTO bands VALUES (?, ?, ?)", args: ["b1", "Codeine", 5] });

    const hit = await client.execute({ sql: "DELETE FROM bands WHERE id = ?", args: ["b1"] });
    const miss = await client.execute({ sql: "DELETE FROM bands WHERE id = ?", args: ["nope"] });

    assert.equal(hit.rowsAffected, 1);
    assert.equal(miss.rowsAffected, 0, "a delete matching nothing must report 0, not 1");
    await client.close();
  });
});

test("batch runs every statement in order and returns one result each", async () => {
  await withTempDir(async (dir) => {
    const client = await localClient(dir);

    const results = await client.batch([
      { sql: "INSERT INTO bands VALUES (?, ?, ?) RETURNING *", args: ["b1", "Codeine", 5] },
      { sql: "UPDATE bands SET rating = ? WHERE id = ?", args: [3, "b1"] },
    ], "write");

    assert.equal(results.length, 2);
    assert.equal(results[0].rows[0].name, "Codeine", "a RETURNING statement must still yield its row inside a batch");
    assert.equal(results[1].rowsAffected, 1);

    const after = await client.execute("SELECT rating FROM bands");
    assert.equal(after.rows[0].rating, 3, "later statements must see earlier ones");
    await client.close();
  });
});

// --- sync policy -----------------------------------------------------------

function fakeSyncDatabase() {
  const calls: string[] = [];
  let pushFails = false;
  return {
    calls,
    failPush() { pushFails = true; },
    db: {
      exec: async () => {},
      prepare: async () => ({
        all: async () => [],
        run: async () => ({ changes: 0, lastInsertRowid: 0 }),
      }),
      push: async () => {
        calls.push("push");
        if (pushFails) throw new Error("offline");
      },
      pull: async () => { calls.push("pull"); return false; },
      close: async () => { calls.push("close"); },
    },
  };
}

test("a write pushes local changes to the remote", async () => {
  const fake = fakeSyncDatabase();
  const client = await createTursoSyncClient({
    path: "unused.db",
    url: "libsql://example.turso.io",
    connectImpl: async () => fake.db,
  });

  await client.execute({ sql: "INSERT INTO bands VALUES (?, ?, ?)", args: ["b1", "Codeine", 5] });

  assert.deepEqual(fake.calls, ["push"]);
  await client.close();
});

test("a read does not push", async () => {
  const fake = fakeSyncDatabase();
  const client = await createTursoSyncClient({
    path: "unused.db",
    url: "libsql://example.turso.io",
    connectImpl: async () => fake.db,
  });

  await client.execute("SELECT * FROM bands");

  assert.deepEqual(fake.calls.filter((c) => c === "push"), []);
  await client.close();
});

// The whole point of local-first: losing the network must not lose the write.
test("a failing push does not fail the write", async () => {
  const fake = fakeSyncDatabase();
  const warnings: unknown[] = [];
  const client = await createTursoSyncClient({
    path: "unused.db",
    url: "libsql://example.turso.io",
    connectImpl: async () => fake.db,
    logger: { warn: (o: unknown) => warnings.push(o) },
  });
  fake.failPush();

  await client.execute({ sql: "INSERT INTO bands VALUES (?, ?, ?)", args: ["b1", "Codeine", 5] });

  assert.equal(warnings.length, 1, "the failure must be reported, not swallowed silently");
  await client.close();
});

test("no url means local-only: writes never attempt to sync", async () => {
  await withTempDir(async (dir) => {
    const client = await localClient(dir);
    // push()/pull() throw on a database opened without sync support, so the
    // client must not call them at all rather than catching the error.
    await client.execute({ sql: "INSERT INTO bands VALUES (?, ?, ?)", args: ["b1", "Codeine", 5] });
    assert.equal(client.isSyncEnabled(), false);
    await client.close();
  });
});

test("sync() pulls remote changes and pushes local ones", async () => {
  const fake = fakeSyncDatabase();
  const client = await createTursoSyncClient({
    path: "unused.db",
    url: "libsql://example.turso.io",
    connectImpl: async () => fake.db,
  });

  await client.sync();

  assert.deepEqual(fake.calls, ["pull", "push"]);
  await client.close();
});

// INSERT … RETURNING is both a write and a row-returning statement. Dispatching
// on "returns rows" alone would have left every saved band unsynced.
test("an INSERT ... RETURNING pushes even though it yields rows", async () => {
  const fake = fakeSyncDatabase();
  const client = await createTursoSyncClient({
    path: "unused.db",
    url: "libsql://example.turso.io",
    connectImpl: async () => fake.db,
  });

  await client.execute({ sql: "INSERT INTO bands VALUES (?, ?, ?) RETURNING *", args: ["b1", "Codeine", 5] });

  assert.deepEqual(fake.calls, ["push"]);
  await client.close();
});
