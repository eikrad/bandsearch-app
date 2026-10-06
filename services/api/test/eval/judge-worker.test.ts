import test from "node:test";
import assert from "node:assert/strict";
import type { ChatModelClient } from "../../src/agent/modelUtils.js";
import { resolveLlmConfig } from "../../src/config/models.js";
import { buildJudgePrompt, createJudgeWorker, judgeModelFor } from "../../src/eval/judgeWorker.js";
import { createInMemoryEvalRepository, createNoOpEvalRepository } from "../../src/eval/evalRepository.js";
import type { BandEvalScoreInput } from "../../src/eval/evalRepository.js";
import { assertArray, assertRecord } from "../helpers/typeAssertions.js";

type Prompt = Array<{ role: string; content: string }>;

/** A judge model that answers with `reply` (or throws it) and records each prompt. */
function fakeJudge(reply: string | Error, prompts: Prompt[] = []): ChatModelClient {
  return {
    async invoke(prompt) {
      prompts.push(prompt);
      if (reply instanceof Error) throw reply;
      return { content: reply };
    },
  };
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

const judgeReply = JSON.stringify({
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
});

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

test("the judge sends all bands in one call, system prompt first", async () => {
  const prompts: Prompt[] = [];
  const worker = createJudgeWorker({
    judgeModel: fakeJudge(judgeReply, prompts),
    modelId: "mistral-medium-3.5-128b",
    evalRepository: createInMemoryEvalRepository(),
  });

  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(prompts.length, 1, "exactly one call for all bands");
  assert.deepEqual(prompts[0]!.map((m) => m.role), ["system", "user"]);
  assert.ok(prompts[0]![1]!.content.includes("Wolves in the Throne Room"));
  assert.ok(prompts[0]![1]!.content.includes("Deafheaven"));
});

test("the judge stores each band's scores with the model that produced them", async () => {
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
  const worker = createJudgeWorker({
    judgeModel: fakeJudge(judgeReply),
    modelId: "mistral-medium-3.5-128b",
    evalRepository: repo,
  });

  await worker.judgeEvent(eventId, sampleBands);

  const scores = await repo.listBandEvalScores(eventId);
  const wittr = scores.find((s) => s.bandName === "Wolves in the Throne Room");
  assert.ok(wittr, "WITTR score should exist");
  assert.equal(wittr.relevance, 0.9);
  assert.equal(wittr.obscurityFit, 0.8);
  assert.equal(wittr.evidenceQuality, 0.7);
  assert.equal(wittr.discoveryValue, 0.85);
  assert.ok(typeof wittr.judgePromptHash === "string" && wittr.judgePromptHash.length > 0);
  // Provenance must name the model that was called. An earlier version recorded
  // a hard-coded model id that had never seen the input.
  assert.equal(wittr.modelId, "mistral-medium-3.5-128b");
  const deafheaven = scores.find((s) => s.bandName === "Deafheaven");
  assert.equal(deafheaven?.obscurityFit, 0.3);
});

test("the judge upserts once per band", async () => {
  const upsertCalls: BandEvalScoreInput[] = [];
  const worker = createJudgeWorker({
    judgeModel: fakeJudge(judgeReply),
    modelId: "m",
    evalRepository: { ...createNoOpEvalRepository(), upsertBandEvalScore: async (input) => { upsertCalls.push(input); } },
  });

  await worker.judgeEvent("event-1", sampleBands);

  assert.deepEqual(upsertCalls.map((c) => c.bandName).sort(), ["Deafheaven", "Wolves in the Throne Room"]);
});

test("a judge answer wrapped in prose or a reasoning block is still read", async () => {
  const upsertCalls: BandEvalScoreInput[] = [];
  const worker = createJudgeWorker({
    judgeModel: fakeJudge(`<think>{"draft": true} weighing both bands</think>Here you go:\n${judgeReply}`),
    modelId: "m",
    evalRepository: { ...createNoOpEvalRepository(), upsertBandEvalScore: async (input) => { upsertCalls.push(input); } },
  });

  await worker.judgeEvent("event-1", sampleBands);

  assert.equal(upsertCalls.length, 2);
});

for (const [what, reply] of [
  ["a timeout", new Error("judge timeout")],
  ["a provider error", new Error("429 Too Many Requests")],
  ["malformed JSON", "not valid json {{{"],
] as const) {
  test(`the judge never throws on ${what}: scoring is off the request path`, async () => {
    const worker = createJudgeWorker({
      judgeModel: fakeJudge(reply),
      modelId: "m",
      evalRepository: createInMemoryEvalRepository(),
    });
    await assert.doesNotReject(() => worker.judgeEvent("event-1", sampleBands));
  });
}

test("the judge makes no call when there is nothing to judge", async () => {
  const prompts: Prompt[] = [];
  const worker = createJudgeWorker({
    judgeModel: fakeJudge(judgeReply, prompts),
    modelId: "m",
    evalRepository: createInMemoryEvalRepository(),
  });

  await worker.judgeEvent("event-1", []);

  assert.equal(prompts.length, 0);
});

// ─── the configured judge, over HTTP ──────────────────────────────────────────

test("the configured judge asks Scaleway for JSON at temperature 0", async () => {
  const bodies: Array<{ url: string; auth: string | null; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    bodies.push({ url: request.url, auth: request.headers.get("authorization"), body: (await request.json()) as Record<string, unknown> });
    return new Response(
      JSON.stringify({
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "glm-5.2",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: judgeReply } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const llm = resolveLlmConfig({ GEMINI_API_KEY: "g", SCW_SECRET_KEY: "scw" });

  const judgeModel = judgeModelFor(llm, fetchImpl);
  assert.ok(judgeModel, "a Scaleway key configures a judge");
  const worker = createJudgeWorker({ judgeModel, modelId: llm.judge!.model, evalRepository: createInMemoryEvalRepository() });
  await worker.judgeEvent("e1", sampleBands);

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]!.url, "https://api.scaleway.ai/v1/chat/completions");
  assert.equal(bodies[0]!.auth, "Bearer scw");
  assert.equal(bodies[0]!.body.model, "glm-5.2");
  assert.equal(bodies[0]!.body.temperature, 0);
  assert.deepEqual(bodies[0]!.body.response_format, { type: "json_object" });
});

test("without a Scaleway key there is no judge model", () => {
  assert.equal(judgeModelFor(resolveLlmConfig({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "g" })), null);
});
