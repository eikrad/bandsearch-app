import test from "node:test";
import assert from "node:assert/strict";
import { buildJudgePrompt, createJudgeWorker as createWorker } from "../../src/eval/judgeWorker.js";
import { createInMemoryEvalRepository, createNoOpEvalRepository } from "../../src/eval/evalRepository.js";
import type { BandEvalScoreInput, EvalRepository } from "../../src/eval/evalRepository.js";
import { assertArray, assertRecord } from "../helpers/typeAssertions.js";

type JudgeWorkerOptions = Parameters<typeof createWorker>[0];
type FetchCall = { url: string; init: RequestInit };

// A fetch stub matching the real signature, so the worker's call is type-checked
// the same way production is.
function recordingFetch(calls: FetchCall[], body: unknown): typeof globalThis.fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    return jsonResponse(body);
  };
}

function requestBody(call: FetchCall): Record<string, unknown> {
  assert.ok(typeof call.init.body === "string", "request body should be a JSON string");
  const parsed: unknown = JSON.parse(call.init.body);
  assertRecord(parsed);
  return parsed;
}

function createJudgeWorker(options: JudgeWorkerOptions) {
  return createWorker(options);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
  choices: [
    {
      message: {
        content: JSON.stringify({
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
    },
  ],
};

test("buildJudgePrompt: includes all bands in one user message", () => {
  const { system, user } = buildJudgePrompt(sampleBands);

  assert.ok(typeof system === "string" && system.length > 0, "system prompt should be non-empty");
  const parsed: unknown = JSON.parse(user);
  assertArray(parsed);
  assert.equal(parsed.length, 2);
  assert.ok(parsed.some((band) => {
    assertRecord(band);
    return band.band_name === "Wolves in the Throne Room";
  }));
  assert.ok(parsed.some((band) => {
    assertRecord(band);
    return band.band_name === "Deafheaven";
  }));
});

test("buildJudgePrompt: includes all required fields per band", () => {
  const { user } = buildJudgePrompt(sampleBands);
  const parsed: unknown = JSON.parse(user);
  assertArray(parsed);
  const wittr = parsed.find((band) => {
    assertRecord(band);
    return band.band_name === "Wolves in the Throne Room";
  });
  assertRecord(wittr);
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
  const bands = [{ ...sampleBands[0], obscurityTier: "cult" }];
  const parsed: unknown = JSON.parse(buildJudgePrompt(bands).user);
  assertArray(parsed);
  assertRecord(parsed[0]);
  assert.equal(parsed[0].obscurity_tier, "cult");
});

test("createJudgeWorker: no-op when mistralApiKey is empty", async () => {
  const fetchCalls: FetchCall[] = [];
  const fetchStub = recordingFetch(fetchCalls, successResponseBody);

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(fetchCalls.length, 0, "no fetch call when API key is absent");
});

test("createJudgeWorker: sends all bands in one batched request (not per-band)", async () => {
  const fetchCalls: FetchCall[] = [];
  const fetchStub = recordingFetch(fetchCalls, successResponseBody);

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(fetchCalls.length, 1, "exactly one API call for all bands");
  const body = requestBody(fetchCalls[0]);
  assert.match(String(body.model), /mistral/i);
  assertArray(body.messages);
  // messages[0] is the system prompt under Mistral's OpenAI-shaped API; the
  // batched bands are in the user message that follows it.
  assertRecord(body.messages[1]);
  const userContent = body.messages[1].content;
  assert.ok(typeof userContent === "string", "user message content should be a string");
  assert.ok(userContent.includes("Wolves in the Throne Room"), "user message should contain WITTR");
  assert.ok(userContent.includes("Deafheaven"), "user message should contain Deafheaven");
});

test("createJudgeWorker: parses batch response and upserts scores per band", async () => {
  const fetchCalls: FetchCall[] = [];
  const fetchStub = recordingFetch(fetchCalls, successResponseBody);

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

  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent(eventId, sampleBands);

  const scores = await repo.listBandEvalScores(eventId);
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(wittr, "WITTR score should exist");
  assert.equal(wittr.relevance, 0.9);
  assert.equal(wittr.obscurityFit, 0.8);
  assert.equal(wittr.evidenceQuality, 0.7);
  assert.equal(wittr.discoveryValue, 0.85);
  assert.ok(typeof wittr.judgePromptHash === "string" && wittr.judgePromptHash.length > 0, "judgePromptHash should be set");
  // Recorded provenance must name the model that was actually called. This used
  // to assert a hardcoded "claude-opus-4-8" and kept passing after the judge
  // moved to Mistral, so every score row claimed a model that never saw it.
  assert.equal(wittr.modelId, String(requestBody(fetchCalls[0]).model));
  assert.match(String(wittr.modelId), /mistral/i);

  const deafheaven = scores.find((s) => s.bandName === "Deafheaven");
  assert.ok(deafheaven, "Deafheaven score should exist");
  assert.equal(deafheaven.relevance, 0.8);
  assert.equal(deafheaven.obscurityFit, 0.3);
});

test("createJudgeWorker: upsertBandEvalScore called once per band with parsed scores", async () => {
  const upsertCalls: BandEvalScoreInput[] = [];
  const repoStub: EvalRepository = {
    ...createNoOpEvalRepository(),
    upsertBandEvalScore: async (input) => { upsertCalls.push(input); },
  };
  const fetchStub = async () => jsonResponse(successResponseBody);

  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repoStub, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(upsertCalls.length, 2, "upsert called once per band");
  assert.ok(upsertCalls.some((c) => c.bandName === "Wolves in the Throne Room"));
  assert.ok(upsertCalls.some((c) => c.bandName === "Deafheaven"));
});

test("createJudgeWorker: does not throw on AbortError (timeout)", async () => {
  const fetchStub = async () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    throw error;
  };

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });

  await assert.doesNotReject(() => worker.judgeEvent("event-1", sampleBands));
});

test("createJudgeWorker: does not throw on malformed JSON response", async () => {
  const fetchStub = async () => jsonResponse({ choices: [{ message: { content: "not valid json {{{" } }] });

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });

  await assert.doesNotReject(() => worker.judgeEvent("event-1", sampleBands));
});

test("createJudgeWorker: does not throw on non-ok API response", async () => {
  const fetchStub = async () => jsonResponse({}, 429);

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });

  await assert.doesNotReject(() => worker.judgeEvent("event-1", sampleBands));
});

test("createJudgeWorker: does not call fetch when bands array is empty", async () => {
  const fetchCalls: FetchCall[] = [];
  const fetchStub = recordingFetch(fetchCalls, {});

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("event-1", []);

  assert.equal(fetchCalls.length, 0, "no fetch call for empty band list");
});



test("the judge calls Mistral, with the key it was given", async () => {
  // The defect: MISTRAL_API_KEY was handed to a worker that POSTs to
  // api.anthropic.com with x-api-key and anthropic-version headers. A Mistral
  // key sent there can only ever 401, which is exactly what production logged.
  // The env var name was right; the implementation was built against the wrong
  // provider and the mismatch was recorded as a naming quirk.
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchStub = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return jsonResponse(successResponseBody);
  }) as unknown as typeof fetch;

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("e1", sampleBands);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.(eu\.)?mistral\.ai\/v1\/chat\/completions$/);
  assert.equal(calls[0].headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].headers["x-api-key"], undefined, "the Anthropic auth header must be gone");
  assert.equal(calls[0].headers["anthropic-version"], undefined);
  assert.match(String(calls[0].body.model), /mistral/i);
});

test("the judge asks Mistral for JSON rather than hoping for it", async () => {
  // Mistral supports response_format: json_object. The prompt already demands
  // JSON, but asking the API for it too removes a class of parse failure the
  // worker otherwise swallows silently.
  const calls: Array<Record<string, unknown>> = [];
  const fetchStub = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return jsonResponse(successResponseBody);
  }) as unknown as typeof fetch;

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("e1", sampleBands);

  assert.deepEqual(calls[0].response_format, { type: "json_object" });
});

test("the system prompt is sent as a message, not an Anthropic system block", async () => {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  const fetchStub = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> });
    return jsonResponse(successResponseBody);
  }) as unknown as typeof fetch;

  const repo = createInMemoryEvalRepository();
  const worker = createJudgeWorker({ mistralApiKey: "test-key", evalRepository: repo, fetchImpl: fetchStub });
  await worker.judgeEvent("e1", sampleBands);

  assert.equal(calls[0].messages[0].role, "system");
  assert.equal(calls[0].messages[1].role, "user");
});
