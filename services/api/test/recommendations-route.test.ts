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
    noteEdited: false,
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
            evidenceUrls: [],
            listenerCount: null,
          },
          {
            artist: "Fen",
            why: "Stylistic overlap",
            sourceSignals: ["agent_reasoning"],
            evidenceUrls: [],
            listenerCount: null,
          },
          {
            artist: "Les Discrets",
            why: "Mood similarity",
            sourceSignals: ["agent_reasoning"],
            evidenceUrls: [],
            listenerCount: null,
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
  arrayField(firstRecommendation, "evidenceUrls");
  assert.equal(typeof firstRecommendation.listenerCount === "number" || firstRecommendation.listenerCount === null, true);
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
              evidenceUrls: [],
              listenerCount: null,
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
          recommendations: [{ artist: "Les Discrets", why: "Similar tone", sourceSignals: ["musicbrainz_search"], evidenceUrls: [], listenerCount: null }],
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
          recommendations: [{ artist: "Fen", why: "Matched", sourceSignals: ["musicbrainz_search"], evidenceUrls: [], listenerCount: null }],
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
          recommendations: [{ artist: "Fen", why: "Matched", sourceSignals: ["musicbrainz_search"], evidenceUrls: [], listenerCount: null }],
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
          recommendations: [{ artist: "Fen", why: "dark", sourceSignals: [], evidenceUrls: [], listenerCount: null }],
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
        recommendations: [{ artist: "Fen", why: "dark", sourceSignals: [], evidenceUrls: [], listenerCount: null }],
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
          recommendations: [{ artist: "Fen", why: "dark", sourceSignals: [], evidenceUrls: [], listenerCount: null }],
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
              evidenceUrls: [],
              listenerCount: null,
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
        recommendations: [{ artist: "Alcest", why: "dreamy", sourceSignals: [], evidenceUrls: [], listenerCount: null }],
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
        recommendations: [{ artist: "Alcest", why: "dreamy", sourceSignals: [], evidenceUrls: [], listenerCount: null }],
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

test("an answer in words is no batch: no event id to rate, nothing for eval to score", async () => {
  const processed: EvalEventContext[] = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({ recommendations: [], assistantReply: "You're welcome.", meta: { turn: "answer" } }),
    },
    evalWorker: { processEvent: async (ctx) => { processed.push(ctx); } },
  });

  const result = await makeRequest(app, "/recommendations", { query: "thanks" });

  const meta = recordField(result.data, "meta");
  assert.equal(meta.turn, "answer");
  assert.equal("eventId" in meta, false);
  assert.equal(meta.aiGenerated, true, "it is generated text all the same");
  assert.equal(processed.length, 0);
});

test("the conversation id reaches the pipeline but not the eval telemetry", async () => {
  // recommendation_events identifies no one; the id must not link its rows to a chat.
  const asked: Record<string, unknown>[] = [];
  const processed: EvalEventContext[] = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async (req: Record<string, unknown>) => {
        asked.push(req);
        return { recommendations: [], assistantReply: "", meta: { turn: "search" } };
      },
    },
    evalWorker: { processEvent: async (ctx) => { processed.push(ctx); } },
  });

  await makeRequest(app, "/recommendations", { query: "blackgaze", conversationId: "chat-1" });

  assert.equal(asked[0]!.conversationId, "chat-1");
  assert.doesNotMatch(JSON.stringify(processed), /chat-1/);
});

/** Posts a question asking for a stream and returns what came back. */
async function askForStream(app: ReturnType<typeof createApp>, payload: unknown) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/recommendations`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    const events = text.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as Record<string, unknown>);
    return { status: response.status, type: response.headers.get("content-type") ?? "", text, events };
  } finally {
    server.close();
  }
}

test("a client that asks for a stream follows the answer and gets the whole response at the end", async () => {
  const app = createApp({
    recommendationPipeline: {
      recommend: async (_req, listener) => {
        listener?.onProgress?.({ stage: "searching", anchorArtists: ["Alcest"] });
        listener?.onReply?.("Try");
        listener?.onReply?.("Try Fe");
        await new Promise((r) => setTimeout(r, 60));
        listener?.onReply?.("Try Fen.");
        return { recommendations: [{ artist: "Fen", why: "A specific recommendation.", sourceSignals: [], evidenceUrls: [], listenerCount: null }], assistantReply: "Try Fen.", meta: { turn: "search" } };
      },
    },
  });

  const { type, events } = await askForStream(app, { query: "blackgaze" });

  assert.match(type, /^text\/event-stream/);
  assert.deepEqual(events[0], { type: "progress", progress: { stage: "searching", anchorArtists: ["Alcest"] } });
  // A reply carries the whole text so far, so not every one is sent: the
  // stream sends at most one per 50 ms, and a job keeps only the newest.
  const replies = events.filter((e) => e.type === "reply").map((e) => e.text as string);
  assert.ok(replies.every((text) => "Try Fen.".startsWith(text)));
  assert.equal(replies.at(-1), "Try Fen.");
  const done = events.at(-1)!;
  assert.equal(done.type, "done");
  const response = done.response as { recommendations: unknown[]; assistantReply: string; meta: Record<string, unknown> };
  assert.equal(response.assistantReply, "Try Fen.");
  assert.equal(response.recommendations.length, 1);
  assert.equal(typeof response.meta.eventId, "string");
  assert.equal(response.meta.aiGenerated, true);
});

test("a failure after the stream opened arrives as its last event", async () => {
  const app = createApp({
    recommendationPipeline: {
      recommend: async (_req, listener) => {
        listener?.onProgress?.({ stage: "thinking" });
        throw new Error("secret upstream detail");
      },
    },
    logger: { warn: () => {}, error: () => {} },
  });
  const { events, text } = await askForStream(app, { query: "blackgaze" });
  assert.deepEqual(events.at(-1), {
    type: "error", status: 502, error: { code: "recommendation_unavailable", message: "recommendation service unavailable" },
  });
  assert.doesNotMatch(text, /secret/);
});

test("a failure or an answer before the first event is plain JSON with its status, stream or not", async () => {
  const failing = createApp({
    recommendationPipeline: { recommend: async () => { throw Object.assign(new Error("x"), { code: "recommendation_initializing" }); } },
    logger: { warn: () => {}, error: () => {} },
  });
  const failed = await askForStream(failing, { query: "blackgaze" });
  assert.equal(failed.status, 503);
  assert.match(failed.type, /json/);
  assert.equal((await askForStream(failing, { query: "" })).status, 400);

  const quick = createApp({ recommendationPipeline: { recommend: async () => ({ recommendations: [], meta: {} }) } });
  assert.match((await askForStream(quick, { query: "blackgaze" })).type, /json/);
});

test("without asking for a stream the answer is one JSON response, whatever the pipeline reports", async () => {
  const app = createApp({
    recommendationPipeline: {
      recommend: async (_req, listener) => {
        listener?.onProgress?.({ stage: "thinking" });
        listener?.onReply?.("h");
        return { recommendations: [], assistantReply: "hi", meta: {} };
      },
    },
  });
  const result = await makeRequest(app, "/recommendations", { query: "blackgaze" });
  assert.equal(result.status, 200);
  assert.equal(result.data.assistantReply, "hi");
  assert.equal("type" in result.data, false, "no event leaks into the JSON");
});

// ADR 0006: a search runs as a job, and a dropped connection (a phone whose
// screen went off) no longer throws the work away. Stop is an explicit DELETE.
test("a client that stops waiting no longer cancels the search: it runs to its end", async () => {
  let finish!: () => void;
  let signal: AbortSignal | undefined;
  const scored = new Promise<EvalEventContext>((resolve) => {
    const evalWorker: EvalWorker = { processEvent: async (ctx) => resolve(ctx) };
    const app = createApp({
      recommendationPipeline: {
        recommend: (_req, listener) => new Promise((resolve) => {
          signal = listener?.signal;
          finish = () => resolve({ recommendations: [{ artist: "Fen", why: "A specific recommendation.", sourceSignals: [], evidenceUrls: [], listenerCount: null }], assistantReply: "", meta: { turn: "search" } });
        }),
      },
      evalWorker,
    });
    void hangUpEarly(app, () => finish());
  });
  assert.equal((await scored).recommendations.length, 1, "the finished batch still reached eval");
  assert.equal(signal?.aborted, false);
});

/** Posts a question, hangs up before the answer, then lets the search finish. */
async function hangUpEarly(app: ReturnType<typeof createApp>, thenFinish: () => void) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const controller = new AbortController();
  try {
    const request = fetch(`http://127.0.0.1:${address.port}/recommendations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "blackgaze" }),
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await assert.rejects(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    thenFinish();
  } finally {
    server.close();
  }
}

test("a recommendation response carries provenance for its generated text", async () => {
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [
          { artist: "Fen", why: "Stylistic overlap", sourceSignals: ["agent_reasoning"], evidenceUrls: [], listenerCount: null },
        ],
        assistantReply: "One pick for you.",
        meta: { modeUsed: "fresh", usedPreferenceContext: false, model: "test-model-7b" },
      }),
    },
  });

  const result = await makeRequest(app, "/recommendations", { query: "post-black metal" });

  assert.equal(result.status, 200);
  const meta = recordField(result.data, "meta");
  assert.equal(meta.aiGenerated, true, "response marks its prose as AI-generated");
  assert.equal(
    typeof stringField(meta, "pipelineVersion"),
    "string",
    "response carries the pipeline version that produced it",
  );
  assert.match(
    stringField(meta, "generatedAt"),
    /^\d{4}-\d{2}-\d{2}T/,
    "response carries an ISO timestamp for when the text was generated",
  );
  assert.equal(stringField(meta, "model"), "test-model-7b", "response names the model that wrote the prose");
});

test("a recommendation that fails is logged with its cause, not only answered with 502", async () => {
  const errors: Array<Record<string, unknown>> = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => {
        throw new Error("recommendation ranker timeout");
      },
    },
    logger: { warn: () => {}, error: (obj: Record<string, unknown>) => errors.push(obj) },
  });

  const result = await makeRequest(app, "/recommendations", { query: "funeral doom" });

  assert.equal(result.status, 502);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.event, "recommendation_failed");
  assert.match(String(errors[0]!.error), /recommendation ranker timeout/);
});
