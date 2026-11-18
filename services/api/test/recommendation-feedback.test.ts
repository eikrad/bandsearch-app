import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import { createApp } from "../src/app.js";
import { createStorage, openStorage } from "../src/storage/createStorage.js";
import {
  FEEDBACK_RETENTION_DAYS,
  createRecommendationFeedback,
  type RecommendationFeedbackRepository,
  type RecommendationFeedbackRow,
} from "../src/feedback/recommendationFeedback.js";
import { createInMemoryFeedbackRepository, createSqliteFeedbackRepository } from "../src/feedback/feedbackRepository.js";
import { createTursoFeedbackRepository } from "../src/feedback/tursoFeedbackRepository.js";
import { assertArray, assertRecord } from "./helpers/typeAssertions.js";
import { withStorageDirectory } from "./helpers/storageDirectory.js";

// ADR 0006: recommendation feedback is product data in the main database. It
// is written through an authenticated route that does not depend on the eval
// dashboard, and the operator reads it with the admin CLI.

const jwtSecret = "recommendation-feedback-test-secret";
const DAY_MS = 24 * 60 * 60 * 1000;

const submission = {
  feedbackType: "too_mainstream",
  query: "slowcore like Codeine",
  mode: "fresh",
  obscurityTarget: "underground",
  bandNames: ["Bedhead", "Duster"],
};

function row(overrides: Partial<RecommendationFeedbackRow> = {}): RecommendationFeedbackRow {
  return {
    id: overrides.id ?? `row-${Math.random().toString(36).slice(2)}`,
    eventId: "event-1",
    userId: "user-1",
    feedbackType: "good",
    query: "slowcore",
    mode: "fresh",
    obscurityTarget: null,
    bandNames: ["Bedhead"],
    createdAt: "2026-11-10T10:00:00.000Z",
    ...overrides,
  };
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

async function withApp(
  app: ReturnType<typeof createApp>,
  run: (request: (method: string, route: string, body?: unknown, token?: string) => Promise<{ status: number; data: Record<string, unknown> }>) => Promise<void>,
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
      const data: unknown = await response.json();
      assertRecord(data);
      return { status: response.status, data };
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

// ---------------------------------------------------------------------------
// The store: one contract, every backend
// ---------------------------------------------------------------------------

async function exerciseFeedbackRepository(repository: RecommendationFeedbackRepository) {
  await repository.upsert(row({ id: "a", feedbackType: "good", bandNames: ["Bedhead", "Duster"], obscurityTarget: "underground" }));
  const [stored] = await repository.listSince("2026-01-01T00:00:00.000Z");
  assert.deepEqual(stored, row({ id: "a", feedbackType: "good", bandNames: ["Bedhead", "Duster"], obscurityTarget: "underground" }));

  // One row per event and user: a later click replaces the earlier one.
  await repository.upsert(row({ id: "b", feedbackType: "wrong_direction", createdAt: "2026-11-10T10:05:00.000Z" }));
  let rows = await repository.listSince("2026-01-01T00:00:00.000Z");
  assert.deepEqual(rows.map((r) => [r.id, r.feedbackType]), [["b", "wrong_direction"]]);

  // Another user, and a click without an account, are separate rows; the
  // anonymous click is replaced by a later anonymous click like any other.
  await repository.upsert(row({ id: "c", userId: "user-2", createdAt: "2026-11-10T10:06:00.000Z" }));
  await repository.upsert(row({ id: "d", userId: null, createdAt: "2026-11-10T10:07:00.000Z" }));
  await repository.upsert(row({ id: "e", userId: null, feedbackType: "too_mainstream", createdAt: "2026-11-10T10:08:00.000Z" }));
  rows = await repository.listSince("2026-01-01T00:00:00.000Z");
  assert.deepEqual(rows.map((r) => [r.id, r.userId]), [["b", "user-1"], ["c", "user-2"], ["e", null]]);

  // listSince is a lower bound, oldest first.
  await repository.upsert(row({ id: "old", eventId: "event-0", createdAt: "2026-07-01T00:00:00.000Z" }));
  assert.deepEqual((await repository.listSince("2026-11-01T00:00:00.000Z")).map((r) => r.id), ["b", "c", "e"]);
  assert.deepEqual((await repository.listSince("2026-01-01T00:00:00.000Z")).map((r) => r.id), ["old", "b", "c", "e"]);

  assert.equal(await repository.purgeOlderThan("2026-08-01T00:00:00.000Z"), 1);
  assert.deepEqual((await repository.listSince("2026-01-01T00:00:00.000Z")).map((r) => r.id), ["b", "c", "e"]);
}

test("the in-memory feedback store keeps one row per event and user and purges by age", async () => {
  await exerciseFeedbackRepository(createInMemoryFeedbackRepository());
});

test("the SQLite feedback store keeps one row per event and user and purges by age", async () => {
  const db = new Database(":memory:");
  try {
    await exerciseFeedbackRepository(createSqliteFeedbackRepository({ db }));
  } finally {
    db.close();
  }
});

test("the Turso feedback store keeps one row per event and user and purges by age", async (context) => withStorageDirectory(context.name, __filename, async (directory) => {
  const client = createClient({ url: `file:${path.join(directory, "turso.db")}` });
  try {
    await applyMigrations(client);
    await exerciseFeedbackRepository(createTursoFeedbackRepository({ client }));
  } finally {
    client.close();
  }
}));

test("a SQLite database with the old eval-shaped feedback table gets the new table", async () => {
  const db = new Database(":memory:");
  try {
    db.exec(`CREATE TABLE recommendation_feedback (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT 'anonymous',
      feedback_type TEXT NOT NULL, created_at TEXT NOT NULL)`);
    db.prepare("INSERT INTO recommendation_feedback VALUES ('legacy', 'event-0', 'anonymous', 'good', '2026-11-01')").run();
    const repository = createSqliteFeedbackRepository({ db });
    assert.deepEqual(await repository.listSince("2026-01-01T00:00:00.000Z"), [], "legacy rows have no context and are dropped");
    await repository.upsert(row({ id: "a" }));
    assert.equal((await repository.listSince("2026-01-01T00:00:00.000Z")).length, 1);
  } finally {
    db.close();
  }
});

test("the eval store's schema no longer creates a feedback table", async () => {
  const { createSqliteEvalRepository } = await import("../src/eval/evalRepository.js");
  const db = new Database(":memory:");
  try {
    createSqliteEvalRepository({ db });
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recommendation_feedback'").get();
    assert.equal(table, undefined);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// The module: validation, capping and retention
// ---------------------------------------------------------------------------

test("a submission is stored with its context, its event and the given user", async () => {
  const repository = createInMemoryFeedbackRepository();
  const feedback = createRecommendationFeedback({ repository, now: () => new Date("2026-11-18T12:00:00.000Z") });
  assert.deepEqual(await feedback.submit("event-1", submission, "user-1"), { ok: true });
  const [stored] = await repository.listSince("2026-01-01T00:00:00.000Z");
  assert.equal(stored.eventId, "event-1");
  assert.equal(stored.userId, "user-1");
  assert.equal(stored.feedbackType, "too_mainstream");
  assert.equal(stored.query, "slowcore like Codeine");
  assert.equal(stored.mode, "fresh");
  assert.equal(stored.obscurityTarget, "underground");
  assert.deepEqual(stored.bandNames, ["Bedhead", "Duster"]);
  assert.equal(stored.createdAt, "2026-11-18T12:00:00.000Z");
});

test("a submission caps the query at 500 characters and the list at 20 bands", async () => {
  const repository = createInMemoryFeedbackRepository();
  const feedback = createRecommendationFeedback({ repository });
  const bandNames = Array.from({ length: 25 }, (_, i) => `Band ${i}`);
  assert.deepEqual(await feedback.submit("event-1", { ...submission, query: "x".repeat(2000), bandNames }, null), { ok: true });
  const [stored] = await repository.listSince("2000-01-01T00:00:00.000Z");
  assert.equal(stored.query.length, 500);
  assert.deepEqual(stored.bandNames, bandNames.slice(0, 20));
  assert.equal(stored.userId, null);
});

test("an invalid submission is refused and nothing is stored", async () => {
  const repository = createInMemoryFeedbackRepository();
  const feedback = createRecommendationFeedback({ repository });
  const invalid: [unknown, unknown][] = [
    ["", submission],
    ["x".repeat(101), submission],
    ["event-1", { ...submission, feedbackType: "meh" }],
    ["event-1", { ...submission, query: "" }],
    ["event-1", { ...submission, mode: "random" }],
    ["event-1", { ...submission, bandNames: "Bedhead" }],
    ["event-1", { ...submission, bandNames: [1, 2] }],
    ["event-1", { ...submission, obscurityTarget: 3 }],
    ["event-1", null],
  ];
  for (const [eventId, body] of invalid) {
    const result = await feedback.submit(eventId, body, "user-1");
    assert.equal(result.ok, false, `${String(eventId)} ${JSON.stringify(body)} should be refused`);
  }
  assert.deepEqual(await repository.listSince("2000-01-01T00:00:00.000Z"), []);
});

test("an absent obscurity target is stored as none", async () => {
  const repository = createInMemoryFeedbackRepository();
  const feedback = createRecommendationFeedback({ repository });
  const withoutTarget: Record<string, unknown> = { ...submission };
  delete withoutTarget.obscurityTarget;
  assert.deepEqual(await feedback.submit("event-1", withoutTarget, "user-1"), { ok: true });
  assert.equal((await repository.listSince("2000-01-01T00:00:00.000Z"))[0].obscurityTarget, null);
});

test(`feedback is kept for ${FEEDBACK_RETENTION_DAYS} days`, async () => {
  assert.equal(FEEDBACK_RETENTION_DAYS, 90);
  const now = new Date("2026-11-18T12:00:00.000Z");
  const repository = createInMemoryFeedbackRepository();
  await repository.upsert(row({ id: "expired", eventId: "e1", createdAt: new Date(now.getTime() - 91 * DAY_MS).toISOString() }));
  await repository.upsert(row({ id: "kept", eventId: "e2", createdAt: new Date(now.getTime() - 89 * DAY_MS).toISOString() }));
  const feedback = createRecommendationFeedback({ repository, now: () => now });
  assert.equal(await feedback.purgeExpired(), 1);
  assert.deepEqual((await repository.listSince("2000-01-01T00:00:00.000Z")).map((r) => r.id), ["kept"]);
});

test("listing covers the given number of days back from now", async () => {
  const now = new Date("2026-11-18T12:00:00.000Z");
  const repository = createInMemoryFeedbackRepository();
  await repository.upsert(row({ id: "last-week", eventId: "e1", createdAt: new Date(now.getTime() - 6 * DAY_MS).toISOString() }));
  await repository.upsert(row({ id: "last-month", eventId: "e2", createdAt: new Date(now.getTime() - 20 * DAY_MS).toISOString() }));
  const feedback = createRecommendationFeedback({ repository, now: () => now });
  assert.deepEqual((await feedback.listRecent(7)).map((r) => r.id), ["last-week"]);
  assert.deepEqual((await feedback.listRecent(30)).map((r) => r.id), ["last-month", "last-week"]);
});

// ---------------------------------------------------------------------------
// The route, through the app
// ---------------------------------------------------------------------------

test("feedback is accepted with the eval dashboard off and belongs to the authenticated account", async () => {
  const storage = createStorage();
  try {
    const app = createApp({ storage, runtimeConfig: { jwtSecret } });
    await withApp(app, async (request) => {
      const one = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
      const two = await request("POST", "/auth/register", { email: "two@example.com", displayName: "Two", password: "pw" });
      assertRecord(one.data.user);
      assertRecord(two.data.user);
      const token = String(one.data.token);

      // The body cannot pick the owner.
      const posted = await request("POST", "/recommendations/event-1/feedback", { ...submission, userId: two.data.user.id }, token);
      assert.equal(posted.status, 200, JSON.stringify(posted.data));
      assert.deepEqual(posted.data, { ok: true });

      const rows = await storage.recommendationFeedbackRepository.listSince("2000-01-01T00:00:00.000Z");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].userId, one.data.user.id);
      assert.equal(rows[0].eventId, "event-1");

      const exported = await request("GET", "/account/export", undefined, token);
      assertArray(exported.data.recommendationFeedback);
      assert.equal(exported.data.recommendationFeedback.length, 1);
      assertRecord(exported.data.recommendationFeedback[0]);
      assert.equal(exported.data.recommendationFeedback[0].eventId, "event-1");
      assert.equal(exported.data.recommendationFeedback[0].feedbackType, "too_mainstream");
      assert.equal(exported.data.recommendationFeedback[0].query, "slowcore like Codeine");
      assert.deepEqual(exported.data.recommendationFeedback[0].bandNames, ["Bedhead", "Duster"]);
      const otherExport = await request("GET", "/account/export", undefined, String(two.data.token));
      assert.deepEqual(otherExport.data.recommendationFeedback, []);

      assert.equal((await request("POST", "/account/delete", { password: "pw" }, token)).status, 200);
      assert.deepEqual(await storage.recommendationFeedbackRepository.listSince("2000-01-01T00:00:00.000Z"), []);
    });
  } finally {
    await storage.close();
  }
});

test("enforced auth refuses feedback without a valid token for an active account", async () => {
  const storage = createStorage();
  try {
    let token = "";
    let userId = "";
    await withApp(createApp({ storage, runtimeConfig: { jwtSecret } }), async (request) => {
      const registered = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
      assertRecord(registered.data.user);
      token = String(registered.data.token);
      userId = String(registered.data.user.id);
    });
    await withApp(createApp({ storage, runtimeConfig: { jwtSecret, authMode: "enforced" } }), async (request) => {
      assert.equal((await request("POST", "/recommendations/event-1/feedback", submission)).status, 401);
      assert.equal((await request("POST", "/recommendations/event-1/feedback", submission, "invalid-token")).status, 401);
      assert.equal((await request("POST", "/recommendations/event-1/feedback", submission, token)).status, 200);
      await storage.userRepository.setDisabled(userId, true);
      assert.equal((await request("POST", "/recommendations/event-1/feedback", submission, token)).status, 401);
    });
    assert.equal((await storage.recommendationFeedbackRepository.listSince("2000-01-01T00:00:00.000Z")).length, 1);
  } finally {
    await storage.close();
  }
});

test("a personal install without accounts stores feedback without a user", async () => {
  const storage = createStorage();
  try {
    await withApp(createApp({ storage }), async (request) => {
      assert.equal((await request("POST", "/recommendations/event-1/feedback", submission)).status, 200);
    });
    const rows = await storage.recommendationFeedbackRepository.listSince("2000-01-01T00:00:00.000Z");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, null);
  } finally {
    await storage.close();
  }
});

test("an invalid feedback submission is answered with a validation error", async () => {
  const storage = createStorage();
  try {
    await withApp(createApp({ storage }), async (request) => {
      const response = await request("POST", "/recommendations/event-1/feedback", { ...submission, feedbackType: "meh" });
      assert.equal(response.status, 400);
      assertRecord(response.data.error);
      assert.equal(response.data.error.code, "validation_error");
    });
  } finally {
    await storage.close();
  }
});

test("the old eval feedback route is gone, even with the dashboard on", async () => {
  const storage = createStorage({ evalDashboardEnabled: true });
  try {
    await withApp(createApp({ storage, runtimeConfig: { evalDashboardEnabled: true } }), async (request) => {
      assert.equal((await request("POST", "/eval/feedback", { eventId: "event-1", feedbackType: "good" })).status, 404);
    });
  } finally {
    await storage.close();
  }
});

test("the app purges expired feedback when it starts", async () => {
  const storage = createStorage();
  try {
    const expired = new Date(Date.now() - (FEEDBACK_RETENTION_DAYS + 1) * DAY_MS).toISOString();
    await storage.recommendationFeedbackRepository.upsert(row({ id: "expired", createdAt: expired }));
    await storage.recommendationFeedbackRepository.upsert(row({ id: "fresh", eventId: "event-2", createdAt: new Date().toISOString() }));
    createApp({ storage });
    // The startup purge is fire-and-forget; give it its turn.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual((await storage.recommendationFeedbackRepository.listSince("2000-01-01T00:00:00.000Z")).map((r) => r.id), ["fresh"]);
  } finally {
    await storage.close();
  }
});

// ---------------------------------------------------------------------------
// The eval store is chosen by the storage module, never on Turso
// ---------------------------------------------------------------------------

test("with the dashboard off the eval store records nothing", async () => {
  const storage = createStorage({ preferenceStore: "sqlite" });
  try {
    await storage.evalRepository.logEvent({
      query: "slowcore", mode: "fresh", pipelineVersion: "test", recommendationCount: 1,
      pipelineDiagnostics: { braveHitCount: 1, extractedCandidateCount: 1, verifiedCount: 1, reflectionTriggered: false, searchBudgetUsed: 1 },
    });
    assert.deepEqual(await storage.evalRepository.listEvents(), []);
  } finally {
    await storage.close();
  }
});

test("with the dashboard on a Turso deployment keeps eval telemetry in a local SQLite file", async (context) => withStorageDirectory(context.name, __filename, async (directory) => {
  const tursoPath = path.join(directory, "turso.db");
  const evalPath = path.join(directory, "eval.db");
  const client = createClient({ url: `file:${tursoPath}` });
  try { await applyMigrations(client); } finally { client.close(); }
  const storage = await openStorage({
    preferenceStore: "turso",
    tursoDatabaseUrl: `file:${tursoPath}`,
    databasePath: evalPath,
    evalDashboardEnabled: true,
  });
  try {
    await storage.evalRepository.logEvent({
      query: "slowcore", mode: "fresh", pipelineVersion: "test", recommendationCount: 1,
      pipelineDiagnostics: { braveHitCount: 1, extractedCandidateCount: 1, verifiedCount: 1, reflectionTriggered: false, searchBudgetUsed: 1 },
    });
    assert.equal((await storage.evalRepository.listEvents()).length, 1);
  } finally {
    await storage.close();
  }
  const local = new Database(evalPath, { readonly: true });
  try {
    assert.equal((local.prepare("SELECT COUNT(*) AS n FROM recommendation_events").get() as { n: number }).n, 1);
  } finally {
    local.close();
  }
}));
