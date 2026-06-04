const test = require("node:test");
const assert = require("node:assert/strict");

const sampleBands = [
  {
    bandName: "Wolves in the Throne Room",
    query: "atmospheric black metal",
    obscurityTarget: "underground",
    why: "Atmospheric DSBM from the Pacific Northwest.",
    sourceSignals: ["https://bandcamp.com/wittr"],
    listeners: 80000,
    citationSupportRate: 1.0,
    genericWhyFlag: false,
  },
  {
    bandName: "Deafheaven",
    query: "atmospheric black metal",
    obscurityTarget: "underground",
    why: "Known for their blackgaze sound.",
    sourceSignals: [],
    listeners: 600000,
    citationSupportRate: 1.0,
    genericWhyFlag: true,
  },
];

const successResponseBody = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        "Wolves in the Throne Room": {
          relevance: 0.9,
          obscurity_fit: 0.8,
          evidence_quality: 0.7,
          discovery_value: 0.85,
          reasoning: "Excellent atmospheric black metal, fits underground target.",
        },
        Deafheaven: {
          relevance: 0.8,
          obscurity_fit: 0.3,
          evidence_quality: 0.4,
          discovery_value: 0.6,
          reasoning: "Well-known band, generic why-text.",
        },
      }),
    },
  ],
};

test("buildJudgePrompt: includes all bands in one user message", () => {
  const { buildJudgePrompt } = require("../../src/eval/judgeWorker");
  const { system, user } = buildJudgePrompt(sampleBands);

  assert.ok(typeof system === "string" && system.length > 0, "system prompt should be non-empty");
  const parsed = JSON.parse(user);
  assert.equal(parsed.length, 2);
  assert.ok(parsed.some((b) => b.band_name === "Wolves in the Throne Room"));
  assert.ok(parsed.some((b) => b.band_name === "Deafheaven"));
});

test("buildJudgePrompt: includes all required fields per band", () => {
  const { buildJudgePrompt } = require("../../src/eval/judgeWorker");
  const { user } = buildJudgePrompt(sampleBands);
  const parsed = JSON.parse(user);
  const wittr = parsed.find((b) => b.band_name === "Wolves in the Throne Room");
  assert.ok(wittr, "WITTR should be in parsed output");
  assert.ok("query" in wittr);
  assert.ok("obscurity_target" in wittr);
  assert.ok("why" in wittr);
  assert.ok("source_signals" in wittr);
  assert.ok("listeners" in wittr);
  assert.ok("citation_support_rate" in wittr);
  assert.ok("generic_why_flag" in wittr);
});

// ─── F3: judge thresholds aligned with obscurityScorer ──────────────────────

test("buildJudgePrompt: system prompt thresholds match OBSCURITY_THRESHOLDS", () => {
  const { buildJudgePrompt } = require("../../src/eval/judgeWorker");
  const { system } = buildJudgePrompt(sampleBands);
  // Correct tier floors from obscurityScorer: cult 20k, underground 2k, mainstream 500k
  assert.ok(system.includes("20,000"), "cult floor 20,000 should appear");
  assert.ok(system.includes("2,000"), "underground floor 2,000 should appear");
  assert.ok(system.includes("500,000"), "mainstream floor 500,000 should appear");
  // The old, wrong numbers must be gone
  assert.ok(!/100k|under 100,000|< 100,000/.test(system), "stale 100k underground threshold removed");
  assert.ok(!/\b10k\b|under 10,000|< 10,000/.test(system), "stale 10k obscure threshold removed");
});

test("buildJudgePrompt: includes obscurity_tier per band when provided", () => {
  const { buildJudgePrompt } = require("../../src/eval/judgeWorker");
  const bands = [{ ...sampleBands[0], obscurityTier: "cult" }];
  const parsed = JSON.parse(buildJudgePrompt(bands).user);
  assert.equal(parsed[0].obscurity_tier, "cult");
});

test("createJudgeWorker: no-op when anthropicApiKey is empty", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const fetchCalls = [];
  const fetchStub = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, json: async () => successResponseBody };
  };

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ anthropicApiKey: "", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(fetchCalls.length, 0, "no fetch call when API key is absent");
});

test("createJudgeWorker: sends all bands in one batched request (not per-band)", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const fetchCalls = [];
  const fetchStub = async (url, options) => {
    fetchCalls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => successResponseBody };
  };

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(fetchCalls.length, 1, "exactly one API call for all bands");
  const body = fetchCalls[0].body;
  assert.equal(body.model, "claude-opus-4-8");
  const userContent = body.messages[0].content;
  assert.ok(userContent.includes("Wolves in the Throne Room"), "user message should contain WITTR");
  assert.ok(userContent.includes("Deafheaven"), "user message should contain Deafheaven");
});

test("createJudgeWorker: parses batch response and upserts scores per band", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const fetchStub = async () => ({ ok: true, json: async () => successResponseBody });

  const repo = createInMemoryEvalRepository();
  const eventId = await repo.logEvent({
    query: "atmospheric black metal",
    mode: "fresh",
    pipelineVersion: "1.0.0",
    pipelineDiagnostics: {
      braveHitCount: 0,
      extractedCandidateCount: 0,
      verifiedCount: 0,
      reflectionTriggered: false,
      searchBudgetUsed: 0,
    },
    recommendationCount: 2,
  });

  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent(eventId, sampleBands);

  const scores = await repo.listBandEvalScores(eventId);
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(wittr, "WITTR score should exist");
  assert.equal(wittr.relevance, 0.9);
  assert.equal(wittr.obscurityFit, 0.8);
  assert.equal(wittr.evidenceQuality, 0.7);
  assert.equal(wittr.discoveryValue, 0.85);
  assert.ok(typeof wittr.judgePromptHash === "string" && wittr.judgePromptHash.length > 0, "judgePromptHash should be set");
  assert.equal(wittr.modelId, "claude-opus-4-8");

  const deafheaven = scores.find((s) => s.bandName === "Deafheaven");
  assert.ok(deafheaven, "Deafheaven score should exist");
  assert.equal(deafheaven.relevance, 0.8);
  assert.equal(deafheaven.obscurityFit, 0.3);
});

test("createJudgeWorker: upsertBandEvalScore called once per band with parsed scores", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const upsertCalls = [];
  const repoStub = {
    upsertBandEvalScore: async (input) => { upsertCalls.push(input); },
    logEvent: async () => "event-1",
    listEvents: async () => [],
    listBandEvalScores: async () => [],
  };
  const fetchStub = async () => ({ ok: true, json: async () => successResponseBody });

  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repoStub, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(upsertCalls.length, 2, "upsert called once per band");
  assert.ok(upsertCalls.some((c) => c.bandName === "Wolves in the Throne Room"));
  assert.ok(upsertCalls.some((c) => c.bandName === "Deafheaven"));
});

test("createJudgeWorker: does not throw on AbortError (timeout)", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const fetchStub = async () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  };

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });

  await assert.doesNotReject(() => worker.judgeEvent("event-1", sampleBands));
});

test("createJudgeWorker: does not throw on malformed JSON response", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const fetchStub = async () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: "not valid json {{{" }] }),
  });

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });

  await assert.doesNotReject(() => worker.judgeEvent("event-1", sampleBands));
});

test("createJudgeWorker: does not throw on non-ok API response", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const fetchStub = async () => ({ ok: false, status: 429, json: async () => ({}) });

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });

  await assert.doesNotReject(() => worker.judgeEvent("event-1", sampleBands));
});

test("createJudgeWorker: does not call fetch when bands array is empty", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const fetchCalls = [];
  const fetchStub = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, json: async () => ({}) };
  };

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", []);

  assert.equal(fetchCalls.length, 0, "no fetch call for empty band list");
});

test("createJudgeWorker: prompt caching header is sent with request", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const capturedHeaders = [];
  const fetchStub = async (_url, options) => {
    capturedHeaders.push(options.headers);
    return { ok: true, json: async () => successResponseBody };
  };

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(capturedHeaders.length, 1);
  assert.ok(capturedHeaders[0]["anthropic-beta"]?.includes("prompt-caching"), "prompt-caching beta header should be sent");
});

test("createJudgeWorker: system message has cache_control ephemeral", async () => {
  const { createJudgeWorker } = require("../../src/eval/judgeWorker");
  const { createInMemoryEvalRepository } = require("../../src/eval/evalRepository");
  const capturedBodies = [];
  const fetchStub = async (_url, options) => {
    capturedBodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => successResponseBody };
  };

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ anthropicApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", sampleBands);

  const body = capturedBodies[0];
  const systemBlocks = Array.isArray(body.system) ? body.system : [];
  const cacheBlock = systemBlocks.find((b) => b.cache_control?.type === "ephemeral");
  assert.ok(cacheBlock, "system prompt should have cache_control: ephemeral block");
});
