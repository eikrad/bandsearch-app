import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  createInMemoryEvalRepository,
  createNoOpEvalRepository,
  createSqliteEvalRepository,
} from "../../src/eval/evalRepository.js";

const sampleDiagnostics = {
  braveHitCount: 10,
  extractedCandidateCount: 6,
  verifiedCount: 4,
  reflectionTriggered: false,
  searchBudgetUsed: 4,
};

const sampleEvent = {
  query: "dark ambient like Lustmord",
  mode: "fresh",
  obscurityTarget: "obscure",
  pipelineVersion: "0.4.0-alpha.0",
  pipelineDiagnostics: sampleDiagnostics,
  recommendationCount: 5,
};

test("createInMemoryEvalRepository: logEvent returns a non-empty string id", async () => {
  const repo = createInMemoryEvalRepository();
  const id = await repo.logEvent(sampleEvent);
  assert.ok(typeof id === "string" && id.length > 0);
});

test("createInMemoryEvalRepository: logEvent round-trips the full event shape", async () => {
  const repo = createInMemoryEvalRepository();
  await repo.logEvent(sampleEvent);
  const events = await repo.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].query, sampleEvent.query);
  assert.equal(events[0].mode, sampleEvent.mode);
  assert.equal(events[0].obscurityTarget, sampleEvent.obscurityTarget);
  assert.equal(events[0].recommendationCount, sampleEvent.recommendationCount);
  assert.equal(events[0].pipelineDiagnostics.braveHitCount, sampleDiagnostics.braveHitCount);
  assert.equal(events[0].pipelineDiagnostics.verifiedCount, sampleDiagnostics.verifiedCount);
  assert.equal(events[0].pipelineDiagnostics.reflectionTriggered, false);
  assert.ok(typeof events[0].id === "string" && events[0].id.length > 0);
  assert.ok(typeof events[0].createdAt === "string" && events[0].createdAt.length > 0);
});

test("createInMemoryEvalRepository: listEvents respects limit", async () => {
  const repo = createInMemoryEvalRepository();
  for (let i = 0; i < 5; i++) {
    await repo.logEvent({ ...sampleEvent, query: `query ${i}` });
  }
  const events = await repo.listEvents(3);
  assert.equal(events.length, 3);
});

test("createInMemoryEvalRepository: listEvents returns most recent first", async () => {
  const repo = createInMemoryEvalRepository();
  await repo.logEvent({ ...sampleEvent, query: "first" });
  await new Promise((r) => setTimeout(r, 5));
  await repo.logEvent({ ...sampleEvent, query: "second" });
  const events = await repo.listEvents();
  assert.equal(events[0].query, "second");
});

test("createNoOpEvalRepository: logEvent returns a string", async () => {
  const repo = createNoOpEvalRepository();
  const id = await repo.logEvent(sampleEvent);
  assert.ok(typeof id === "string");
});

test("createNoOpEvalRepository: listEvents returns empty array", async () => {
  const repo = createNoOpEvalRepository();
  const events = await repo.listEvents();
  assert.deepEqual(events, []);
});

test("createInMemoryEvalRepository: upsertBandEvalScore stores and lists scores per event", async () => {
  const repo = createInMemoryEvalRepository();
  const eventId = await repo.logEvent(sampleEvent);

  await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", listeners: 30000, obscurityTier: "cult" });
  await repo.upsertBandEvalScore({ eventId, bandName: "Raison d'être", listeners: 1500, obscurityTier: "obscure" });

  const scores = await repo.listBandEvalScores(eventId);
  assert.equal(scores.length, 2);
  const lustmord = scores.find((s) => s.bandName === "Lustmord");
  assert.ok(lustmord, "Lustmord score should exist");
  assert.equal(lustmord.listeners, 30000);
  assert.equal(lustmord.obscurityTier, "cult");
});

test("createInMemoryEvalRepository: upsertBandEvalScore merges fields for the same (event, band)", async () => {
  const repo = createInMemoryEvalRepository();
  const eventId = await repo.logEvent(sampleEvent);

  await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", listeners: 30000, obscurityTier: "cult" });
  await repo.upsertBandEvalScore({ eventId, bandName: "Lustmord", sourceQuality: "high" });

  const scores = await repo.listBandEvalScores(eventId);
  assert.equal(scores.length, 1);
  assert.equal(scores[0].listeners, 30000);
  assert.equal(scores[0].obscurityTier, "cult");
  assert.equal(scores[0].sourceQuality, "high");
});

test("createInMemoryEvalRepository: listBandEvalScores returns empty for unknown event", async () => {
  const repo = createInMemoryEvalRepository();
  const scores = await repo.listBandEvalScores("does-not-exist");
  assert.deepEqual(scores, []);
});

test("createNoOpEvalRepository: band score methods are safe no-ops", async () => {
  const repo = createNoOpEvalRepository();
  await repo.upsertBandEvalScore({ eventId: "x", bandName: "y" });
  assert.deepEqual(await repo.listBandEvalScores("x"), []);
});

/** Insert an event with an explicit age — logEvent always stamps "now". */
function seedEvent(db: InstanceType<typeof Database>, id: string, createdAt: string) {
  db.prepare(
    `INSERT INTO recommendation_events (id, query, mode, pipeline_version, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, "post-black metal", "fresh", "0.0.0-test", createdAt);
}

test("recommendation events past the retention period are purged", async () => {
  const db = new Database(":memory:");
  const repo = createSqliteEvalRepository({ db });
  seedEvent(db, "ev-old", new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString());
  seedEvent(db, "ev-new", new Date().toISOString());

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const purged = await repo.purgeEventsOlderThan(cutoff);

  assert.equal(purged, 1);
  const remaining = await repo.listEvents(100);
  assert.deepEqual(remaining.map((e) => e.id), ["ev-new"], "only the expired event is gone");
});

test("events inside the retention period are kept", async () => {
  const db = new Database(":memory:");
  const repo = createSqliteEvalRepository({ db });
  seedEvent(db, "ev-recent", new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString());

  await repo.purgeEventsOlderThan(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  const remaining = await repo.listEvents(100);
  assert.equal(remaining.length, 1, "a ten-day-old event survives a ninety-day window");
});

test("purging an event removes its scores and feedback", async () => {
  const db = new Database(":memory:");
  const repo = createSqliteEvalRepository({ db });
  seedEvent(db, "ev-old", new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString());
  await repo.upsertBandEvalScore({ eventId: "ev-old", bandName: "Fen", relevance: 1 });
  await repo.logFeedback({ eventId: "ev-old", userId: "u-1", feedbackType: "good" });

  await repo.purgeEventsOlderThan(new Date().toISOString());

  const scores = await repo.listBandEvalScores("ev-old");
  assert.deepEqual(scores, [], "child scores go with the purged event");
  const feedback = db
    .prepare("SELECT COUNT(*) n FROM recommendation_feedback WHERE event_id = ?")
    .get("ev-old") as { n: number };
  assert.equal(feedback.n, 0, "child feedback goes with the purged event");
});
