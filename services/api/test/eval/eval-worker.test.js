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

test("createNoOpEvalWorker: processEvent does nothing and does not throw", async () => {
  const { createNoOpEvalWorker } = require("../../src/eval/evalWorker");
  const worker = createNoOpEvalWorker();
  await worker.processEvent(sampleCtx);
});
