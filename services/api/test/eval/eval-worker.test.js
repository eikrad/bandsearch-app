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

test("createEvalWorker: processEvent without lastFmClient still stores heuristic scores (no listeners/tier)", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(sampleCtx);

  const events = await repo.listEvents();
  assert.equal(events.length, 1);
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.equal(scores.length, 2, "heuristics always produces a score row per band");
  for (const score of scores) {
    assert.equal(score.listeners, undefined, "no listener data without Last.fm client");
    assert.equal(score.obscurityTier, undefined, "no obscurity tier without Last.fm client");
    assert.ok(["high", "medium", "low"].includes(score.sourceQuality));
  }
});

test("createNoOpEvalWorker: processEvent does nothing and does not throw", async () => {
  const { createNoOpEvalWorker } = require("../../src/eval/evalWorker");
  const worker = createNoOpEvalWorker();
  await worker.processEvent(sampleCtx);
});

// ─── Phase 8.4: heuristics enrichment ──────────────────────────────────────

const heuristicsCtx = {
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
  recommendations: [
    {
      artist: "Wolves in the Throne Room",
      why: "Atmospheric DSBM. See https://bandcamp.com/wittr for details.",
      sourceSignals: ["https://bandcamp.com/wittr", "musicbrainz_verification", "web_search"],
    },
    {
      artist: "Deafheaven",
      why: "Known for their blackgaze sound.",
      sourceSignals: ["https://example.com/deafheaven", "agent_reasoning"],
    },
  ],
};

test("createEvalWorker: scoreHeuristics stores source_quality per band", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(heuristicsCtx);

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.equal(scores.length, 2);
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(["high", "medium", "low"].includes(wittr.sourceQuality), `unexpected sourceQuality: ${wittr.sourceQuality}`);
});

test("createEvalWorker: scoreHeuristics stores citationSupportRate and genericWhyFlag per band", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(heuristicsCtx);

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);

  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(typeof wittr.citationSupportRate === "number", "citationSupportRate should be a number");
  assert.ok(typeof wittr.genericWhyFlag === "boolean", "genericWhyFlag should be a boolean");

  const deafheaven = scores.find((s) => s.bandName === "Deafheaven");
  assert.equal(deafheaven.genericWhyFlag, true, "Deafheaven why is generic ('Known for their')");
});

test("createEvalWorker: scoreHeuristics does not throw when why/sourceSignals are missing", async () => {
  const { createEvalWorker } = require("../../src/eval/evalWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  const ctxWithMissingFields = {
    ...heuristicsCtx,
    recommendations: [{ artist: "Unknown Band" }],
  };

  await assert.doesNotReject(() => worker.processEvent(ctxWithMissingFields));
});
