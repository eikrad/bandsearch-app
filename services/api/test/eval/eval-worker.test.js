const test = require("node:test");
const assert = require("node:assert/strict");

const sampleCtx = {
  query: "atmospheric black metal",
  mode: "fresh",
  pipelineVersion: "0.4.0-alpha.0",
  pipelineDiagnostics: {
    braveHitCount: 8,
    extractedCandidateCount: 5,
    verifiedCount: 3,
    reflectionTriggered: false,
    searchBudgetUsed: 4,
  },
  recommendations: [{ artist: "Wolves in the Throne Room" }, { artist: "Deafheaven" }],
};

test("createEvalWorker: processEvent logs event via evalRepository", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(sampleCtx);

  const events = await repo.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].query, "atmospheric black metal");
  assert.equal(events[0].recommendationCount, 2);
  assert.equal(events[0].pipelineDiagnostics.braveHitCount, 8);
});

test("createEvalWorker: processEvent stores obscurityTarget when provided", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent({ ...sampleCtx, obscurityTarget: "underground" });

  const events = await repo.listEvents();
  assert.equal(events[0].obscurityTarget, "underground");
});

test("createEvalWorker: processEvent enriches each band with obscurity scores", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const listenerByArtist = {
    "Wolves in the Throne Room": 80000,
    Deafheaven: 600000,
  };
  const lastFmClient = {
    getListenerCount: async (name) => listenerByArtist[name] ?? null,
  };
  const worker = createEvalWorker({ evalRepository: repo, lastFmClient });

  await worker.processEvent(sampleCtx);

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.equal(scores.length, 2);
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.equal(wittr.listeners, 80000);
  assert.equal(wittr.obscurityTier, "cult");
  const deafheaven = scores.find((s) => s.bandName === "Deafheaven");
  assert.equal(deafheaven.listeners, 600000);
  assert.equal(deafheaven.obscurityTier, "mainstream");
});

test("createEvalWorker: processEvent records unknown tier when Last.fm has no data", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const lastFmClient = { getListenerCount: async () => null };
  const worker = createEvalWorker({ evalRepository: repo, lastFmClient });

  await worker.processEvent(sampleCtx);

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.equal(scores.length, 2);
  assert.equal(scores[0].obscurityTier, "unknown");
  assert.equal(scores[0].listeners, null);
});

test("createEvalWorker: processEvent does not throw when one band's lookup fails", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const lastFmClient = {
    getListenerCount: async (name) => {
      if (name === "Deafheaven") throw new Error("boom");
      return 5000;
    },
  };
  const worker = createEvalWorker({ evalRepository: repo, lastFmClient });

  await worker.processEvent(sampleCtx);

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);
  // The successful band is still recorded; the failed one is tolerated.
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.equal(wittr.obscurityTier, "underground");
});

test("createEvalWorker: processEvent without lastFmClient just logs the event", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(sampleCtx);

  const events = await repo.listEvents();
  assert.equal(events.length, 1);
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.deepEqual(scores, []);
});

test("createNoOpEvalWorker: processEvent does nothing and does not throw", async () => {
  const { createNoOpEvalWorker } = require("../../src/eval/evalWorker");
  const worker = createNoOpEvalWorker();
  await worker.processEvent(sampleCtx);
});
