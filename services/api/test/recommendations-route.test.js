const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

function createPreferenceRepositoryStub(buildContext) {
  return {
    addSavedBand: async () => ({ ok: true, savedBand: null }),
    listSavedBands: async () => [],
    updateSavedBand: async () => ({ ok: false, status: 404, error: "saved band not found" }),
    deleteSavedBand: async () => ({ ok: false, status: 404, error: "saved band not found" }),
    buildContext: async () => buildContext(),
    buildContextForIds: async () => "",
    importSavedBands: async () => ({ imported: 0, skipped: 0 }),
    listGroups: async () => [],
    createGroup: async () => ({ ok: false, status: 400, error: "stub" }),
    renameGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    deleteGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    addArtistToGroup: async () => ({ ok: false, status: 404, error: "stub" }),
    removeArtistFromGroup: async () => ({ ok: false, status: 404, error: "stub" }),
  };
}

async function makeRequest(app, path, payload) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

test("POST /recommendations rejects empty query", async () => {
  const app = createApp();
  const result = await makeRequest(app, "/recommendations", { query: "" });

  assert.equal(result.status, 400);
  assert.equal(result.data.error.code, "validation_error");
  assert.equal(result.data.error.message, "query is required");
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
  assert.equal(Array.isArray(result.data.recommendations), true);
  assert.equal(result.data.recommendations.length, 3);
  assert.equal(typeof result.data.recommendations[0].artist, "string");
  assert.equal(typeof result.data.recommendations[0].why, "string");
  assert.equal(Array.isArray(result.data.recommendations[0].sourceSignals), true);
  assert.equal(result.data.meta.modeUsed, "fresh");
  assert.equal(result.data.meta.usedPreferenceContext, false);
  assert.equal(typeof result.data.assistantReply, "string");
  assert.equal(result.data.assistantReply.includes("heavier"), true);
});

test("POST /recommendations uses injected recommendation pipeline", async () => {
  const calls = [];
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
    preferenceRepository: createPreferenceRepositoryStub(
      () => "Alcest (rating 5/5) tags: blackgaze note: dreamy",
    ),
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like blackgaze",
    mode: "preference-aware",
  });

  assert.equal(result.status, 200);
  assert.equal(result.data.recommendations[0].artist, "Les Discrets");
  assert.equal(result.data.recommendations[0].sourceSignals[0], "musicbrainz_search");
  assert.equal(result.data.meta.modeUsed, "preference-aware");
  assert.equal(result.data.meta.usedPreferenceContext, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "preference-aware");
});

test("POST /recommendations returns 503 when pipeline is initializing", async () => {
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => {
        const error = new Error("booting");
        error.code = "recommendation_initializing";
        throw error;
      },
    },
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like blackgaze",
  });

  assert.equal(result.status, 503);
  assert.equal(result.data.error.code, "recommendation_initializing");
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
  assert.equal(result.data.error.code, "recommendation_unavailable");
  assert.equal(result.data.error.message, "recommendation service unavailable");
});

test("POST /recommendations logs prompt_safety_truncate when priorityContext is over limit", async () => {
  const PRIORITY_CONTEXT_MAX_LEN = 2000;
  const logEvents = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [],
        assistantReply: "ok",
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      }),
    },
    logger: { warn: (obj) => logEvents.push(obj) },
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
  const logEvents = [];
  const app = createApp({
    recommendationPipeline: {
      recommend: async () => ({
        recommendations: [],
        assistantReply: "ok",
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      }),
    },
    logger: { warn: (obj) => logEvents.push(obj) },
  });

  await makeRequest(app, "/recommendations", {
    query: "dark ambient",
    priorityContext: "short context",
  });

  const truncateEvent = logEvents.find((e) => e.event === "prompt_safety_truncate");
  assert.equal(truncateEvent, undefined, "should not log truncate for normal context");
});

test("POST /recommendations forwards selectedArtistIds to the pipeline", async () => {
  const calls = [];
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
    preferenceRepository: createPreferenceRepositoryStub(() => ""),
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
  const calls = [];
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
    preferenceRepository: createPreferenceRepositoryStub(() => ""),
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
  const calls = [];
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
    preferenceRepository: createPreferenceRepositoryStub(() => ""),
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like post-black metal",
    mode: "fresh",
    priorityContext: "Priority references: Alcest, Agalloch",
  });

  assert.equal(result.status, 200);
  assert.equal(calls[0].priorityContext, "Priority references: Alcest, Agalloch");
  assert.equal(result.data.meta.usedPreferenceContext, true);
});

// ─── Phase 8.3b: obscurityTarget threading ───────────────────────────────────

test("POST /recommendations forwards obscurityTarget to the pipeline", async () => {
  const calls = [];
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
  const processedContexts = [];
  const evalWorker = {
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
  const processedContexts = [];
  const evalWorker = {
    processEvent: async (ctx) => { processedContexts.push(ctx); },
  };
  const pipelineCalls = [];
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
  const calls = [];
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
    preferenceRepository: createPreferenceRepositoryStub(
      () => "This should not be used in fresh mode.",
    ),
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like post black metal",
  });

  assert.equal(result.status, 200);
  assert.equal(calls[0].mode, "fresh");
  assert.equal(result.data.meta.modeUsed, "fresh");
  assert.equal(result.data.meta.usedPreferenceContext, false);
});
