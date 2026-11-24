import test from "node:test";
import assert from "node:assert/strict";
import { createEvalWorker, createNoOpEvalWorker } from "../../src/eval/evalWorker.js";
import { createInMemoryEvalRepository } from "../../src/eval/evalRepository.js";
import type { JudgeInput, JudgeWorker } from "../../src/eval/judgeWorker.js";

type JudgeEventCall = { eventId: string; bands: JudgeInput[] };

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
  recommendations: [
    { artist: "Wolves in the Throne Room", why: "Atmospheric black metal.", sourceSignals: [], evidenceUrls: [], listenerCount: 80000 },
    { artist: "Deafheaven", why: "Blackgaze.", sourceSignals: [], evidenceUrls: [], listenerCount: 600000 },
  ],
};

test("createEvalWorker: processEvent logs event via evalRepository", async () => {
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
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent({ ...sampleCtx, obscurityTarget: "underground" });

  const events = await repo.listEvents();
  assert.equal(events[0].obscurityTarget, "underground");
});

test("createEvalWorker: scores obscurity from each recommendation's search-time count", async () => {
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(sampleCtx);

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.equal(scores.length, 2);
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(wittr, "WITTR should be scored");
  assert.equal(wittr.listeners, 80000);
  assert.equal(wittr.obscurityTier, "cult");
  const deafheaven = scores.find((s) => s.bandName === "Deafheaven");
  assert.ok(deafheaven, "Deafheaven should be scored");
  assert.equal(deafheaven.listeners, 600000);
  assert.equal(deafheaven.obscurityTier, "mainstream");
});

test("createEvalWorker: processEvent records unknown tier when search has no listener count", async () => {
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent({
    ...sampleCtx,
    recommendations: sampleCtx.recommendations.map((rec) => ({ ...rec, listenerCount: null })),
  });

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.equal(scores.length, 2);
  assert.equal(scores[0].obscurityTier, "unknown");
  assert.equal(scores[0].listeners, null);
});

test("createEvalWorker: processEvent does not throw when search has a missing count", async () => {
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent({
    ...sampleCtx,
    recommendations: sampleCtx.recommendations.map((rec, i) => ({ ...rec, listenerCount: i === 0 ? null : rec.listenerCount })),
  });

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);
  // The successful band is still recorded; the failed one is tolerated.
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(wittr, "WITTR should be scored");
  assert.equal(wittr.obscurityTier, "unknown");
});

test("createEvalWorker: stores search-time obscurity and heuristic scores without lookups", async () => {
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(sampleCtx);

  const events = await repo.listEvents();
  assert.equal(events.length, 1);
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.equal(scores.length, 2, "heuristics always produces a score row per band");
  for (const score of scores) {
    assert.equal(typeof score.listeners, "number", "listener count comes from the recommendation");
    assert.notEqual(score.obscurityTier, "unknown");
    assert.ok(score.sourceQuality, "heuristics always sets sourceQuality");
    assert.ok(["high", "medium", "low"].includes(score.sourceQuality));
  }
});

test("createNoOpEvalWorker: processEvent does nothing and does not throw", async () => {
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
      sourceSignals: ["musicbrainz_verification", "web_search"],
      evidenceUrls: ["https://bandcamp.com/wittr"],
      listenerCount: 80000,
    },
    {
      artist: "Deafheaven",
      why: "Known for their blackgaze sound.",
      sourceSignals: ["agent_reasoning"],
      evidenceUrls: ["https://example.com/deafheaven"],
      listenerCount: 600000,
    },
  ],
};

test("createEvalWorker: scoreHeuristics stores source_quality per band", async () => {
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(heuristicsCtx);

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);
  assert.equal(scores.length, 2);
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(wittr?.sourceQuality, "WITTR should have a sourceQuality");
  assert.ok(["high", "medium", "low"].includes(wittr.sourceQuality), `unexpected sourceQuality: ${wittr.sourceQuality}`);
});

test("createEvalWorker: scoreHeuristics stores citationSupportRate and genericWhyFlag per band", async () => {
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await worker.processEvent(heuristicsCtx);

  const events = await repo.listEvents();
  const scores = await repo.listBandEvalScores(events[0].id);

  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(wittr, "WITTR should be scored");
  assert.ok(typeof wittr.citationSupportRate === "number", "citationSupportRate should be a number");
  assert.ok(typeof wittr.genericWhyFlag === "boolean", "genericWhyFlag should be a boolean");

  const deafheaven = scores.find((s) => s.bandName === "Deafheaven");
  assert.ok(deafheaven, "Deafheaven should be scored");
  assert.equal(deafheaven.genericWhyFlag, true, "Deafheaven why is generic ('Known for their')");
});

test("createEvalWorker: scoreHeuristics accepts an empty why and evidence list", async () => {
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  const ctxWithMissingFields = {
    ...heuristicsCtx,
    recommendations: [{ artist: "Unknown Band", why: "", sourceSignals: [], evidenceUrls: [], listenerCount: null }],
  };

  await assert.doesNotReject(() => worker.processEvent(ctxWithMissingFields));
});

// ─── Phase 8.5: judge integration ──────────────────────────────────────────

test("createEvalWorker: processEvent calls judgeWorker.judgeEvent with enriched band data", async () => {
  const repo = createInMemoryEvalRepository();
  const judgeEventCalls: JudgeEventCall[] = [];
  const judgeWorker: JudgeWorker = {
    judgeEvent: async (eventId, bands) => { judgeEventCalls.push({ eventId, bands }); },
  };

  const worker = createEvalWorker({ evalRepository: repo, judgeWorker });
  await worker.processEvent(heuristicsCtx);

  assert.equal(judgeEventCalls.length, 1, "judgeEvent should be called once");
  assert.ok(typeof judgeEventCalls[0].eventId === "string", "eventId should be a string");
  assert.equal(judgeEventCalls[0].bands.length, 2, "both bands should be passed to judge");
  assert.ok(judgeEventCalls[0].bands.every((b) => typeof b.bandName === "string"), "each entry has bandName");
  assert.ok(judgeEventCalls[0].bands.every((b) => b.query === heuristicsCtx.query), "query is threaded");
});

test("createEvalWorker: processEvent does not call judgeEvent when no judgeWorker provided", async () => {
  const repo = createInMemoryEvalRepository();
  const worker = createEvalWorker({ evalRepository: repo });

  await assert.doesNotReject(() => worker.processEvent(heuristicsCtx));
  const events = await repo.listEvents();
  assert.equal(events.length, 1, "event still logged without judge");
});

test("createEvalWorker: processEvent passes search-time listener and evidence data to judgeWorker", async () => {
  const repo = createInMemoryEvalRepository();
  const judgeEventCalls: JudgeEventCall[] = [];
  const judgeWorker: JudgeWorker = {
    judgeEvent: async (eventId, bands) => { judgeEventCalls.push({ eventId, bands }); },
  };

  const worker = createEvalWorker({ evalRepository: repo, judgeWorker });
  await worker.processEvent(heuristicsCtx);

  const wittr = judgeEventCalls[0].bands.find((b) => b.bandName === "Wolves in the Throne Room");
  assert.ok(wittr, "WITTR should be in judge inputs");
  assert.equal(wittr.listeners, 80000, "listener count is passed from search");
  assert.deepEqual(wittr.evidenceUrls, ["https://bandcamp.com/wittr"]);
  assert.ok(typeof wittr.citationSupportRate === "number", "citationSupportRate populated from heuristics");
  assert.ok(typeof wittr.genericWhyFlag === "boolean", "genericWhyFlag populated from heuristics");
});

test("createEvalWorker: uses search-time recommendation evidence without refetching listeners", async () => {
  const repo = createInMemoryEvalRepository();
  const judgeEventCalls: JudgeEventCall[] = [];
  const judgeWorker: JudgeWorker = {
    judgeEvent: async (eventId, bands) => { judgeEventCalls.push({ eventId, bands }); },
  };
  const worker = createEvalWorker({ evalRepository: repo, judgeWorker });

  await worker.processEvent({
    ...sampleCtx,
    recommendations: [{
      artist: "Fen",
      musicbrainzArtistId: "fen-mbid",
      why: "Atmospheric black metal; https://bandcamp.com/fen",
      sourceSignals: ["web_search", "musicbrainz_verification"],
      evidenceUrls: ["https://bandcamp.com/fen"],
      listenerCount: 4_200,
    }],
  });

  const event = (await repo.listEvents())[0]!;
  const [score] = await repo.listBandEvalScores(event.id);
  assert.equal(score?.listeners, 4_200);
  assert.equal(score?.citationSupportRate, 1);
  assert.equal(score?.sourceQuality, "high");
  assert.equal(judgeEventCalls[0]?.bands[0]?.listeners, 4_200);
  assert.deepEqual(judgeEventCalls[0]?.bands[0]?.evidenceUrls, ["https://bandcamp.com/fen"]);
});
