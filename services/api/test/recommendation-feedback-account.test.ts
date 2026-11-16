import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import { createStorage } from "../src/storage/createStorage.js";
import { createSqliteEvalRepository } from "../src/eval/evalRepository.js";
import { assertArray, assertRecord } from "./helpers/typeAssertions.js";
import { withStorageDirectory } from "./helpers/storageDirectory.js";

const jwtSecret = "feedback-account-test-secret";
const event = {
  query: "slowcore", mode: "fresh", pipelineVersion: "test", recommendationCount: 1,
  pipelineDiagnostics: { braveHitCount: 1, extractedCandidateCount: 1, verifiedCount: 1, reflectionTriggered: false, searchBudgetUsed: 1 },
};

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
        method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
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

test("a failed local feedback erasure leaves the account intact for a successful retry", async () => {
  const storage = createStorage();
  const db = new Database(":memory:");
  const evalRepository = createSqliteEvalRepository({ db });
  try {
    const eventId = await evalRepository.logEvent(event);
    const app = createApp({ storage, evalRepository, runtimeConfig: { jwtSecret, evalDashboardEnabled: true } });
    await withApp(app, async (request) => {
      const registered = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
      assertRecord(registered.data.user);
      const userId = String(registered.data.user.id);
      const token = String(registered.data.token);
      assert.equal((await request("POST", "/eval/feedback", { eventId, feedbackType: "good" }, token)).status, 200);
      db.exec("CREATE TRIGGER prevent_feedback_erasure BEFORE DELETE ON recommendation_feedback BEGIN SELECT RAISE(ABORT, 'test feedback store failure'); END");
      assert.equal((await request("POST", "/account/delete", { password: "pw" }, token)).status, 500);
      assert.ok(await storage.userRepository.findById(userId));
      assert.equal((await evalRepository.listUserFeedback(userId)).length, 1);
      db.exec("DROP TRIGGER prevent_feedback_erasure");
      assert.equal((await request("POST", "/account/delete", { password: "pw" }, token)).status, 200);
      assert.equal(await storage.userRepository.findById(userId), null);
      assert.deepEqual(await evalRepository.listUserFeedback(userId), []);
    });
  } finally {
    db.close();
    await storage.close();
  }
});

test("enforced feedback auth rejects missing, invalid and disabled-account credentials", async () => {
  const storage = createStorage();
  const db = new Database(":memory:");
  const evalRepository = createSqliteEvalRepository({ db });
  try {
    const eventId = await evalRepository.logEvent(event);
    let token = "";
    let userId = "";
    await withApp(createApp({ storage, evalRepository, runtimeConfig: { jwtSecret } }), async (request) => {
      const registered = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
      assertRecord(registered.data.user);
      token = String(registered.data.token);
      userId = String(registered.data.user.id);
    });
    const app = createApp({ storage, evalRepository, runtimeConfig: { jwtSecret, authMode: "enforced", evalDashboardEnabled: true } });
    await withApp(app, async (request) => {
      const body = { eventId, feedbackType: "good" };
      assert.equal((await request("POST", "/eval/feedback", body)).status, 401);
      assert.equal((await request("POST", "/eval/feedback", body, "invalid-token")).status, 401);
      assert.deepEqual(await evalRepository.listUserFeedback(userId), []);
      assert.equal((await request("POST", "/eval/feedback", body, token)).status, 200);
      await storage.userRepository.setDisabled(userId, true);
      assert.equal((await request("POST", "/eval/feedback", body, token)).status, 401);
      assert.equal((await evalRepository.listUserFeedback(userId)).length, 1);
    });
  } finally {
    db.close();
    await storage.close();
  }
});

test("an unavailable local feedback store refuses startup instead of producing incomplete account data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "feedback-unavailable-"));
  const storage = createStorage();
  try {
    assert.throws(() => createApp({
      storage,
      runtimeConfig: { jwtSecret, databasePath: path.join(directory, "missing", "eval.db"), evalDashboardEnabled: false },
    }), /Cannot open database/);
  } finally {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("disabling the eval dashboard keeps existing local feedback in account export and deletion", async (context) => withStorageDirectory(context.name, __filename, async (directory) => {
  const storage = createStorage({ databasePath: path.join(directory, "account.db") });
  const databasePath = path.join(directory, "eval.db");
  const db = new Database(databasePath);
  const evalRepository = createSqliteEvalRepository({ db });
  try {
    const eventId = await evalRepository.logEvent(event);
    let token = "";
    let userId = "";
    await withApp(createApp({ storage, evalRepository, runtimeConfig: { jwtSecret, evalDashboardEnabled: true } }), async (request) => {
      const registered = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
      assertRecord(registered.data.user);
      token = String(registered.data.token);
      userId = String(registered.data.user.id);
      assert.equal((await request("POST", "/eval/feedback", { eventId, feedbackType: "good" }, token)).status, 200);
    });
    const restarted = createApp({ storage, runtimeConfig: { jwtSecret, databasePath, evalDashboardEnabled: false } });
    await withApp(restarted, async (request) => {
      assert.equal((await request("POST", "/eval/feedback", { eventId, feedbackType: "good" }, token)).status, 404);
      const exported = await request("GET", "/account/export", undefined, token);
      assertArray(exported.data.recommendationFeedback);
      assert.equal(exported.data.recommendationFeedback.length, 1);
      assert.equal((await request("POST", "/account/delete", { password: "pw" }, token)).status, 200);
      assert.deepEqual(await evalRepository.listUserFeedback(userId), []);
    });
  } finally {
    db.close();
    await storage.close();
  }
}));

for (const separateEval of [false, true]) {
  test(`feedback belongs to the authenticated account even when the body names someone else (${separateEval ? "separate" : "shared"} database)`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "feedback-owner-"));
    const databasePath = path.join(directory, "account.db");
    const storage = createStorage({ databasePath });
    const db = new Database(separateEval ? path.join(directory, "eval.db") : databasePath);
    const evalRepository = createSqliteEvalRepository({ db });
    try {
      const eventId = await evalRepository.logEvent(event);
      const app = createApp({ storage, evalRepository, runtimeConfig: { jwtSecret, evalDashboardEnabled: true } });
      await withApp(app, async (request) => {
        const one = await request("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
        const two = await request("POST", "/auth/register", { email: "two@example.com", displayName: "Two", password: "pw" });
        assert.equal(one.status, 201);
        assert.equal(two.status, 201);
        assertRecord(two.data.user);
        assert.equal((await request("POST", "/eval/feedback", { eventId, feedbackType: "good" })).status, 401);
        assert.equal((await request("POST", "/eval/feedback", { eventId, feedbackType: "good" }, "invalid-token")).status, 401);
        const feedback = await request("POST", "/eval/feedback", { eventId, feedbackType: "good", userId: two.data.user.id }, String(one.data.token));
        assert.equal(feedback.status, 200);
        const ownExport = await request("GET", "/account/export", undefined, String(one.data.token));
        assertArray(ownExport.data.recommendationFeedback);
        assert.equal(ownExport.data.recommendationFeedback.length, 1);
        assertRecord(ownExport.data.recommendationFeedback[0]);
        assert.equal(ownExport.data.recommendationFeedback[0].eventId, eventId);
        const otherExport = await request("GET", "/account/export", undefined, String(two.data.token));
        assert.deepEqual(otherExport.data.recommendationFeedback, []);
        // Password failures must leave both stores untouched.
        assert.equal((await request("POST", "/account/delete", { password: "wrong" }, String(one.data.token))).status, 401);
        assertRecord(one.data.user);
        assert.equal((await evalRepository.listUserFeedback(String(one.data.user.id))).length, 1);
        assert.equal((await request("POST", "/account/delete", { password: "pw" }, String(one.data.token))).status, 200);
        assert.deepEqual(await evalRepository.listUserFeedback(String(one.data.user.id)), []);
      });
    } finally {
      db.close();
      await storage.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
