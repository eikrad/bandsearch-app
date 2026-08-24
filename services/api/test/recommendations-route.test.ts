import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import type { PreferenceRepository, SavedBand } from "../src/preferences/preferenceRepository.js";
import type { RecommendationError } from "../src/recommendations.js";
import type { EvalEventContext, EvalWorker } from "../src/eval/evalWorker.js";

function asRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  assert.ok(typeof value === "string");
  return value;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  asRecord(value);
  return value;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  assert.ok(Array.isArray(value));
  return value;
}

function savedBandFixture(overrides: Partial<SavedBand> = {}): SavedBand {
  return {
    id: "pref-1",
    musicbrainzArtistId: "mb-1",
    name: "Alcest",
    rating: 5,
    categories: [],
    note: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// Context is built from saved bands now, so the stub supplies bands rather than
// a ready-made context string.
function createPreferenceRepositoryStub(savedBands: SavedBand[] = []): PreferenceRepository {
  return {
    addSavedBand: async () => ({ ok: true, savedBand: null }),
    listSavedBands: async () => savedBands,
    updateSavedBand: async () => ({ ok: false, status: 404, error: "saved band not found" }),
    deleteSavedBand: async () => ({ ok: false, status: 404, error: "saved band not found" }),
    importSavedBands: async () => ({ imported: 0, skipped: 0, failed: 0 }),
    listGroups: async () => [],
    createGroup: async () => ({ ok: false, status: 400, error: "stub" }),
    renameGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    deleteGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    addArtistToGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    removeArtistFromGroup: async () => ({ ok: false, status: 404, error: "stub" }),
  };
}

async function makeRequest(app: ReturnType<typeof createApp>, path: string, payload: unknown) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data: unknown = await response.json();
    asRecord(data);
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

test("POST /recommendations rejects empty query", async () => {
  const app = createApp();
  const result = await makeRequest(app, "/recommendations", { query: "" });

  assert.equal(result.status, 400);
  const error = recordField(result.data, "error");
  assert.equal(stringField(error, "code"), "validation_error");
  assert.equal(stringField(error, "message"), "query is required");
});

test("POST /recommendations returns recommendation results", async () => {
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [
          {
            artist: "Alcest",
            why: "Matched from profile and query",
            sourceSignals: ["agent_reasoning"],
          },
          {
            artist: "Fen",
            why: "Stylistic overlap",
            sourceSignals: ["agent_reasoning"],
          },
          {
            artist: "Les Discrets",
            why: "Mood similarity",
            sourceSignals: ["agent_reasoning"],
          },
        ],
        assistantReply: "Here are three niche picks that fit your taste. Want something heavier next?",
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      }),
    },
  });
  const result = await makeRequest(app, "/recommendations", {
    query: "I like Alcest and Agalloch",
  });

  assert.equal(result.status, 200);
  const recommendations = arrayField(result.data, "recommendations");
  assert.equal(recommendations.length, 3);
  const firstRecommendation = recommendations[0];
  asRecord(firstRecommendation);
  stringField(firstRecommendation, "artist");
  stringField(firstRecommendation, "why");
  arrayField(firstRecommendation, "sourceSignals");
  const meta = recordField(result.data, "meta");
  assert.equal(stringField(meta, "modeUsed"), "fresh");
  assert.equal(meta.usedPreferenceContext, false);
  assert.equal(stringField(result.data, "assistantReply").includes("heavier"), true);
});

test("POST /recommendations uses injected recommendation pipeline", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async (input) => {
        calls.push(input);
        return {
          recommendations: [
            {
              artist: "Les Discrets",
              why: `Matched from ${input.query}`,
              sourceSignals: ["musicbrainz_search"],
            },
          ],
          meta: { modeUsed: "preference-aware", usedPreferenceContext: true },
        };
      },
    },
    preferenceRepository: createPreferenceRepositoryStub([
      savedBandFixture({ name: "Alcest", rating: 5, categories: ["blackgaze"], note: "dreamy" }),
    ]),
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like blackgaze",
    mode: "preference-aware",
  });

  assert.equal(result.status, 200);
  const firstRecommendation = arrayField(result.data, "recommendations")[0];
  asRecord(firstRecommendation);
  assert.equal(stringField(firstRecommendation, "artist"), "Les Discrets");
  assert.equal(arrayField(firstRecommendation, "sourceSignals")[0], "musicbrainz_search");
  const meta = recordField(result.data, "meta");
  assert.equal(stringField(meta, "modeUsed"), "preference-aware");
  assert.equal(meta.usedPreferenceContext, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "preference-aware");
});

test("POST /recommendations returns 503 when pipeline is initializing", async () => {
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => {
        const error = new Error("booting") as RecommendationError;
        error.code = "recommendation_initializing";
        throw error;
      },
    },
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like blackgaze",
  });

  assert.equal(result.status, 503);
  assert.equal(stringField(recordField(result.data, "error"), "code"), "recommendation_initializing");
});

test("POST /recommendations returns 502 on recommendation service error", async () => {
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => {
        throw new Error("upstream unavailable");
      },
    },
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like blackgaze",
  });

  assert.equal(result.status, 502);
  const error = recordField(result.data, "error");
  assert.equal(stringField(error, "code"), "recommendation_unavailable");
  assert.equal(stringField(error, "message"), "recommendation service unavailable");
});

test("POST /recommendations logs prompt_safety_truncate when priorityContext is over limit", async () => {
  const PRIORITY_CONTEXT_MAX_LEN = 2000;
  const logEvents: Array<{ event?: string; fields?: string[] }> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [],
        assistantReply: "ok",
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      }),
    },
    logger: { warn: (obj: { event?: string; fields?: string[] }) => logEvents.push(obj) },
  });

  await makeRequest(app, "/recommendations", {
    query: "dark ambient",
    priorityContext: "b".repeat(PRIORITY_CONTEXT_MAX_LEN + 100),
  });

  const truncateEvent = logEvents.find((e) => e.event === "prompt_safety_truncate");
  assert.ok(truncateEvent, "should log a prompt_safety_truncate event");
  assert.ok(Array.isArray(truncateEvent.fields) && truncateEvent.fields.includes("priorityContext"));
});

test("POST /recommendations does not log truncate when priorityContext is within limit", async () => {
  const logEvents: Array<{ event?: string; fields?: string[] }> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [],
        assistantReply: "ok",
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      }),
    },
    logger: { warn: (obj: { event?: string; fields?: string[] }) => logEvents.push(obj) },
  });

  await makeRequest(app, "/recommendations", {
    query: "dark ambient",
    priorityContext: "short context",
  });

  const truncateEvent = logEvents.find((e) => e.event === "prompt_safety_truncate");
  assert.equal(truncateEvent, undefined, "should not log truncate for normal context");
});

test("POST /recommendations forwards selectedArtistIds to the pipeline", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async (input) => {
        calls.push(input);
        return {
          recommendations: [{ artist: "Les Discrets", why: "Similar tone", sourceSignals: ["musicbrainz_search"] }],
          assistantReply: "",
          meta: { modeUsed: "preference-aware", usedPreferenceContext: true },
        };
      },
    },
    preferenceRepository: createPreferenceRepositoryStub(),
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like blackgaze",
    mode: "preference-aware",
    selectedArtistIds: ["id-1", "id-2"],
  });

  assert.equal(result.status, 200);
  assert.deepEqual(calls[0].selectedArtistIds, ["id-1", "id-2"]);
  assert.equal(calls[0].mode, "preference-aware");
});

test("POST /recommendations forwards messages to the pipeline", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async (input) => {
        calls.push(input);
        return {
          recommendations: [{ artist: "Fen", why: "Matched", sourceSignals: ["musicbrainz_search"] }],
          assistantReply: "",
          meta: { modeUsed: "fresh", usedPreferenceContext: false },
        };
      },
    },
    preferenceRepository: createPreferenceRepositoryStub(),
  });

  await makeRequest(app, "/recommendations", {
    query: "more like that",
    mode: "fresh",
    messages: [
      { role: "user", content: "I like Alcest" },
      { role: "assistant", content: "Recommended Fen and Deafheaven" },
    ],
  });

  assert.equal(calls.length, 1);
  assert.ok(Array.isArray(calls[0].messages), "messages forwarded to pipeline");
  assert.equal(calls[0].messages.length, 2);
});

test("POST /recommendations forwards priorityContext to the pipeline", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async (input) => {
        calls.push(input);
        return {
          recommendations: [{ artist: "Fen", why: "Matched", sourceSignals: ["musicbrainz_search"] }],
          assistantReply: "",
          meta: { modeUsed: "fresh", usedPreferenceContext: true },
        };
      },
    },
    preferenceRepository: createPreferenceRepositoryStub(),
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like post-black metal",
    mode: "fresh",
    priorityContext: "Priority references: Alcest, Agalloch",
  });

  assert.equal(result.status, 200);
  assert.equal(calls[0].priorityContext, "Priority references: Alcest, Agalloch");
  assert.equal(recordField(result.data, "meta").usedPreferenceContext, true);
});

// ─── Phase 8.3b: obscurityTarget threading ───────────────────────────────────

test("POST /recommendations forwards obscurityTarget to the pipeline", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async (input) => {
        calls.push(input);
        return {
          recommendations: [{ artist: "Fen", why: "dark", sourceSignals: [] }],
          assistantReply: "",
          meta: { modeUsed: "fresh", usedPreferenceContext: false },
        };
      },
    },
  });

  await makeRequest(app, "/recommendations", {
    query: "dark drone",
    obscurityTarget: "underground",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].obscurityTarget, "underground");
});

test("POST /recommendations passes obscurityTarget to evalWorker.processEvent", async () => {
  const processedContexts: EvalEventContext[] = [];
  const evalWorker: EvalWorker = {
    processEvent: async (ctx) => { processedContexts.push(ctx); },
  };
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [{ artist: "Fen", why: "dark", sourceSignals: [] }],
        assistantReply: "",
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      }),
    },
    evalWorker,
  });

  await makeRequest(app, "/recommendations", {
    query: "dark drone",
    obscurityTarget: "obscure",
  });

  // Give the fire-and-forget a tick to settle
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(processedContexts.length, 1);
  assert.equal(processedContexts[0].obscurityTarget, "obscure");
});

test("POST /recommendations passes undefined obscurityTarget when not set", async () => {
  const processedContexts: EvalEventContext[] = [];
  const evalWorker: EvalWorker = {
    processEvent: async (ctx) => { processedContexts.push(ctx); },
  };
  const pipelineCalls: Array<Record<string, unknown>> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async (input) => {
        pipelineCalls.push(input);
        return {
          recommendations: [{ artist: "Fen", why: "dark", sourceSignals: [] }],
          assistantReply: "",
          meta: { modeUsed: "fresh", usedPreferenceContext: false },
        };
      },
    },
    evalWorker,
  });

  await makeRequest(app, "/recommendations", { query: "dark drone" });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(pipelineCalls[0].obscurityTarget, undefined);
  // evalWorker context uses null (DB-bound), not undefined
  assert.equal(processedContexts[0].obscurityTarget, null);
});

test("POST /recommendations defaults to fresh mode", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async (input) => {
        calls.push(input);
        return {
          recommendations: [
            {
              artist: "Fen",
              why: "Fresh mode recommendation.",
              sourceSignals: ["musicbrainz_search"],
            },
          ],
          meta: { modeUsed: "fresh", usedPreferenceContext: false },
        };
      },
    },
    preferenceRepository: createPreferenceRepositoryStub([
      savedBandFixture({ name: "ShouldNotAppearInFreshMode" }),
    ]),
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like post black metal",
  });

  assert.equal(result.status, 200);
  assert.equal(calls[0].mode, "fresh");
  const meta = recordField(result.data, "meta");
  assert.equal(stringField(meta, "modeUsed"), "fresh");
  assert.equal(meta.usedPreferenceContext, false);
});

test("POST /recommendations includes eventId in meta when evalWorker is set", async () => {
  const processedContexts: EvalEventContext[] = [];
  const evalWorker: EvalWorker = {
    processEvent: async (ctx) => { processedContexts.push(ctx); },
  };
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [{ artist: "Alcest", why: "dreamy", sourceSignals: [] }],
        assistantReply: "",
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      }),
    },
    evalWorker,
  });

  const result = await makeRequest(app, "/recommendations", { query: "blackgaze bands" });

  assert.equal(result.status, 200);
  const eventId = stringField(recordField(result.data, "meta"), "eventId");
  assert.ok(eventId.length > 0, "meta.eventId should not be empty");
});

test("POST /recommendations passes pre-generated eventId to processEvent", async () => {
  const processedContexts: EvalEventContext[] = [];
  const evalWorker: EvalWorker = {
    processEvent: async (ctx) => { processedContexts.push(ctx); },
  };
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [{ artist: "Alcest", why: "dreamy", sourceSignals: [] }],
        assistantReply: "",
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      }),
    },
    evalWorker,
  });

  const result = await makeRequest(app, "/recommendations", { query: "blackgaze bands" });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(result.status, 200);
  assert.equal(processedContexts.length, 1);
  assert.equal(processedContexts[0].eventId, stringField(recordField(result.data, "meta"), "eventId"));
});
