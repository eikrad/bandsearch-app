import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withStorageDirectory } from "./helpers/storageDirectory.js";
import { createClient } from "@libsql/client";
import { createApp } from "../src/app.js";
import { createTursoUserRepository } from "../src/auth/tursoUserRepository.js";
import { createTursoChatSessionRepository } from "../src/sessions/tursoChatSessionRepository.js";
import { createStorage, openAdminStorage, openStorage } from "../src/storage/createStorage.js";
import type { StorageRepositories } from "../src/storage/storageRepositories.js";
import { createTursoSyncRepositories } from "../src/turso/tursoSyncRepositories.js";
import { assertArray, assertRecord } from "./helpers/typeAssertions.js";

const jwtSecret = "storage-consistency-test-secret";

async function withApp(
  app: ReturnType<typeof createApp>,
  run: (request: (method: string, route: string, body?: unknown, token?: string) => Promise<Record<string, unknown>>) => Promise<void>,
) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(async (method, route, body, token) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result: unknown = await response.json();
      assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(result)}`);
      assertRecord(result);
      return result;
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function applyMigrations(client: { execute(sql: string): Promise<unknown> }) {
  const directory = path.join(__dirname, "..", "migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const schema = await readFile(path.join(directory, file), "utf8");
    for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) {
      await client.execute(statement);
    }
  }
}

async function exerciseAccountLifecycle(storage: StorageRepositories) {
  const eventId = "event-1";
  const feedback = { query: "slowcore", mode: "fresh", obscurityTarget: "underground", bandNames: ["Bedhead"] };
  // The eval dashboard stays off, as in production: feedback must not need it.
  const app = createApp({ storage, runtimeConfig: { jwtSecret } });
  await withApp(app, async (request) => {
    const account = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
    const other = await request("POST", "/auth/register", { email: "two@example.com", displayName: "Two", password: "pw" });
    assert.equal(typeof account.token, "string");
    assert.equal(typeof other.token, "string");
    const token = String(account.token);
    const otherToken = String(other.token);
    assertRecord(account.user);
    const userId = String(account.user.id);
    await request("POST", `/recommendations/${eventId}/feedback`, { ...feedback, feedbackType: "good" }, token);
    await request("POST", `/recommendations/${eventId}/feedback`, { ...feedback, feedbackType: "wrong_direction" }, otherToken);
    const band = { musicbrainzArtistId: "mb-codeine", name: "Codeine", rating: 5, categories: ["slowcore"], note: "sparse" };
    await request("POST", "/preferences", band, token);
    await request("POST", "/preferences", { ...band, name: "Other user's band" }, otherToken);
    const savedBands = await storage.preferenceRepository.listSavedBands(userId);
    const createdGroup = await storage.preferenceRepository.createGroup("Slowcore", userId);
    assert.ok(createdGroup.ok && createdGroup.group);
    assert.equal((await storage.preferenceRepository.addArtistToGroup(createdGroup.group.id, savedBands[0].id, userId)).ok, true);
    const created = await request("POST", "/sessions", { title: "Slowcore" }, token);
    assertRecord(created.session);
    const sessionId = String(created.session.id);
    await request("POST", `/sessions/${sessionId}/messages`, { role: "user", content: "bands like Codeine" }, token);

    const exported = await request("GET", "/account/export", undefined, token);
    assertRecord(exported.user);
    assert.equal(exported.user.email, "one@example.com");
    assertArray(exported.recommendationFeedback);
    assert.equal(exported.recommendationFeedback.length, 1);
    assertRecord(exported.recommendationFeedback[0]);
    assert.equal(exported.recommendationFeedback[0].feedbackType, "good");
    assert.equal(exported.recommendationFeedback[0].query, "slowcore");
    assert.deepEqual(exported.recommendationFeedback[0].bandNames, ["Bedhead"]);
    assertArray(exported.savedBands);
    assert.equal(exported.savedBands.length, 1);
    assertRecord(exported.savedBands[0]);
    assert.equal(exported.savedBands[0].name, "Codeine");
    assert.deepEqual(exported.artistGroups, [{ id: createdGroup.group.id, name: "Slowcore", memberIds: [savedBands[0].id] }]);
    assertArray(exported.chatSessions);
    assert.equal(exported.chatSessions.length, 1);
    assertRecord(exported.chatSessions[0]);
    assert.equal(exported.chatSessions[0].title, "Slowcore");
    assertArray(exported.chatSessions[0].messages);
    assert.equal(exported.chatSessions[0].messages.length, 1);
    assertRecord(exported.chatSessions[0].messages[0]);
    assert.equal(exported.chatSessions[0].messages[0].content, "bands like Codeine");

    await request("POST", "/account/delete", { password: "pw" }, token);
    assert.equal(await storage.userRepository.findById(userId), null);
    const remainingFeedback = await storage.recommendationFeedbackRepository.listSince("2000-01-01T00:00:00.000Z");
    assert.deepEqual(remainingFeedback.map((row) => row.feedbackType), ["wrong_direction"]);
    assert.notEqual(remainingFeedback[0].userId, userId);
    assert.deepEqual(await storage.preferenceRepository.listSavedBands(userId), []);
    assert.deepEqual(await storage.preferenceRepository.listGroups(userId), []);
    assert.deepEqual(await storage.chatSessionRepository.listSessions(userId), []);
    assert.deepEqual(await storage.chatSessionRepository.getMessages(sessionId), []);
    const surviving = await request("GET", "/account/export", undefined, otherToken);
    assertRecord(surviving.user);
    assert.equal(surviving.user.email, "two@example.com");
    assertArray(surviving.recommendationFeedback);
    assert.equal(surviving.recommendationFeedback.length, 1);
    assertRecord(surviving.recommendationFeedback[0]);
    assert.equal(surviving.recommendationFeedback[0].feedbackType, "wrong_direction");
    assertArray(surviving.savedBands);
    assert.equal(surviving.savedBands.length, 1);
  });
}

for (const backend of ["sqlite", "turso", "turso-sync"] as const) {
  test(`${backend} accounts export and erase the bands and chat history they actually use`, async (context) => withStorageDirectory(context.name, __filename, async (directory) => {
    const databasePath = path.join(directory, "account.db");
    // Cloud and replica schemas are normally installed by the operator. Exercise
    // the real adapters locally with every migration, without cloud access.
    if (backend === "turso") {
      const client = createClient({ url: `file:${databasePath}` });
      try { await applyMigrations(client); } finally { client.close(); }
    } else if (backend === "turso-sync") {
      const repositories = await createTursoSyncRepositories({ tursoSyncPath: databasePath });
      try { await applyMigrations(repositories.client); } finally { await repositories.client.close(); }
    }
    const storage = await openStorage({
      preferenceStore: backend,
      databasePath,
      tursoDatabaseUrl: backend === "turso" ? `file:${databasePath}` : undefined,
      tursoSyncPath: databasePath,
    });
    try {
      await exerciseAccountLifecycle(storage);
    } finally {
      await storage.close();
    }
  }));
}

for (const override of ["userRepository", "chatSessionRepository"] as const) {
  test(`overriding ${override} leaves the other Turso repositories on Turso`, async (context) => withStorageDirectory(context.name, __filename, async (directory) => {
    const url = `file:${path.join(directory, "turso.db")}`;
    const client = createClient({ url });
    try {
      await applyMigrations(client);
      const overrides = override === "userRepository"
        ? { userRepository: createTursoUserRepository({ client }) }
        : { chatSessionRepository: createTursoChatSessionRepository({ client }) };
      const storage = createStorage({ preferenceStore: "turso", tursoDatabaseUrl: url }, overrides);
      try {
        const app = createApp({ storage, runtimeConfig: { jwtSecret } });
        await withApp(app, async (request) => {
          const account = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
          const token = String(account.token);
          await request("POST", "/preferences", { musicbrainzArtistId: "mb-1", name: "Codeine", rating: null, categories: [], note: "" }, token);
          await request("POST", "/sessions", { title: "Slowcore" }, token);
          const exported = await request("GET", "/account/export", undefined, token);
          assertRecord(exported.user);
          assert.equal(exported.user.email, "one@example.com");
          assertArray(exported.savedBands);
          assert.equal(exported.savedBands.length, 1);
          assertArray(exported.chatSessions);
          assert.equal(exported.chatSessions.length, 1);
        });
      } finally {
        await storage.close();
      }
    } finally {
      client.close();
    }
  }));
}

test("a default SQLite account exports saved bands from its in-memory database", async () => {
  await withApp(createApp({ runtimeConfig: { jwtSecret } }), async (request) => {
    const account = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
    const token = String(account.token);
    await request("POST", "/preferences", { musicbrainzArtistId: "mb-1", name: "Codeine", rating: null, categories: [], note: "" }, token);
    const exported = await request("GET", "/account/export", undefined, token);
    assertArray(exported.savedBands);
    assert.equal(exported.savedBands.length, 1);
    assertRecord(exported.savedBands[0]);
    assert.equal(exported.savedBands[0].name, "Codeine");
  });
});

test("memory storage keeps accounts, invitations and sessions ephemeral even with a database path", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "storage-memory-"));
  const config = { preferenceStore: "memory", databasePath: path.join(directory, "should-not-exist.db") };
  const storage = createStorage(config);
  try {
    const user = await storage.userRepository.create({ email: "one@example.com", displayName: "One", passwordHash: "hash", recoveryCodeHash: "hash" });
    await storage.inviteRepository.create({ email: "two@example.com", codeHash: "invite", expiresAt: "2999-01-01" });
    await storage.chatSessionRepository.createSession({ title: "Slowcore" }, user.id);
    assert.equal(await storage.userRepository.countUsers(), 1);
    assert.equal((await storage.inviteRepository.list()).length, 1);
    assert.equal((await storage.chatSessionRepository.listSessions(user.id)).length, 1);
    assert.equal(storage.userDataStore, null, "memory storage does not claim durable export/erasure");
    await storage.close();
    const restarted = createStorage(config);
    try {
      assert.equal(await restarted.userRepository.countUsers(), 0);
      assert.deepEqual(await restarted.inviteRepository.list(), []);
      assert.deepEqual(await restarted.chatSessionRepository.listSessions(user.id), []);
      assert.deepEqual(await readdir(directory), [], "memory mode must not create a SQLite file");
    } finally {
      await restarted.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unavailable SQLite backend refuses startup instead of mixing in memory repositories", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "storage-unavailable-"));
  try {
    assert.throws(() => createApp({
      preferenceRepository: createStorage({ preferenceStore: "memory" }).preferenceRepository,
      runtimeConfig: { databasePath: path.join(directory, "missing", "account.db"), jwtSecret },
    }), /Cannot open database/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an incomplete sync repository set refuses startup instead of filling gaps with SQLite", () => {
  const memory = createStorage({ preferenceStore: "memory" });
  assert.throws(() => createApp({
    preferenceRepository: memory.preferenceRepository,
    userRepository: memory.userRepository,
    chatSessionRepository: memory.chatSessionRepository,
    runtimeConfig: { preferenceStore: "turso-sync" },
  }), /createTursoSyncRepositories/);
});

test("admin storage under turso-sync talks to the cloud database, not a replica", async (context) => withStorageDirectory(context.name, __filename, async (directory) => {
  const cloudUrl = `file:${path.join(directory, "cloud.db")}`;
  const replicaPath = path.join(directory, "replica.db");
  const cloud = createClient({ url: cloudUrl });
  try {
    await applyMigrations(cloud);
    const storage = openAdminStorage({ preferenceStore: "turso-sync", tursoDatabaseUrl: cloudUrl, tursoSyncPath: replicaPath });
    try {
      await storage.userRepository.create({ email: "one@example.com", displayName: "One", passwordHash: "h", recoveryCodeHash: "h" });
    } finally {
      await storage.close();
    }
    const rows = await cloud.execute("SELECT email FROM users");
    assert.deepEqual(rows.rows.map((row) => row.email), ["one@example.com"]);
    assert.deepEqual((await readdir(directory)).filter((name) => name.startsWith("replica")), [], "no replica is opened");
  } finally {
    cloud.close();
  }
}));

test("admin storage refuses a memory store, which has nothing to administer", () => {
  assert.throws(() => openAdminStorage({ preferenceStore: "memory" }), /durable database/);
});
