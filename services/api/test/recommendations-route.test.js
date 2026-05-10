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
  const app = createApp();
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
});

test("POST /recommendations uses injected recommendation service", async () => {
  const calls = [];
  const app = createApp({
    recommendationService: {
      getRecommendations: async (query, options) => {
        calls.push({ query, options });
        return [
          {
            artist: "Les Discrets",
            why: `Matched from ${query}`,
            sourceSignals: ["musicbrainz_search"],
          },
        ];
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
  assert.equal(calls[0].options.mode, "preference-aware");
  assert.equal(typeof calls[0].options.preferenceContext, "string");
  assert.equal(calls[0].options.preferenceContext.includes("Alcest"), true);
});

test("POST /recommendations returns 502 on recommendation service error", async () => {
  const app = createApp({
    recommendationService: {
      getRecommendations: async () => {
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

test("POST /recommendations with selectedArtistIds uses buildContextForIds", async () => {
  const calls = [];
  const app = createApp({
    recommendationService: {
      getRecommendations: async (query, options) => {
        calls.push({ type: "getRecommendations", query, options });
        return [{ artist: "Les Discrets", why: "Similar tone", sourceSignals: ["musicbrainz_search"] }];
      },
    },
    preferenceRepository: {
      addSavedBand: async () => ({ ok: true, savedBand: null }),
      listSavedBands: async () => [],
      updateSavedBand: async () => ({ ok: false, status: 404, error: "" }),
      deleteSavedBand: async () => ({ ok: false, status: 404, error: "" }),
      buildContext: async () => "fallback context",
      buildContextForIds: async (ids) => {
        calls.push({ type: "buildContextForIds", ids });
        return `context for ${ids.join(",")}`;
      },
    },
  });

  const result = await makeRequest(app, "/recommendations", {
    query: "I like blackgaze",
    mode: "preference-aware",
    selectedArtistIds: ["id-1", "id-2"],
  });

  assert.equal(result.status, 200);
  const buildCall = calls.find((c) => c.type === "buildContextForIds");
  assert.ok(buildCall, "should call buildContextForIds");
  assert.deepEqual(buildCall.ids, ["id-1", "id-2"]);
  const recCall = calls.find((c) => c.type === "getRecommendations");
  assert.equal(recCall.options.preferenceContext.includes("context for"), true);
});

test("POST /recommendations prepends priorityContext to preference context", async () => {
  const calls = [];
  const app = createApp({
    recommendationService: {
      getRecommendations: async (query, options) => {
        calls.push({ query, options });
        return [{ artist: "Fen", why: "Matched", sourceSignals: ["musicbrainz_search"] }];
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
  assert.equal(result.data.meta.usedPreferenceContext, true);
  assert.equal(calls[0].options.preferenceContext.includes("Priority references: Alcest, Agalloch"), true);
});

test("POST /recommendations defaults to fresh mode", async () => {
  const calls = [];
  const app = createApp({
    recommendationService: {
      getRecommendations: async (query, options) => {
        calls.push({ query, options });
        return [
          {
            artist: "Fen",
            why: "Fresh mode recommendation.",
            sourceSignals: ["musicbrainz_search"],
          },
        ];
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
  assert.equal(calls[0].options.mode, "fresh");
  assert.equal(calls[0].options.preferenceContext, "");
  assert.equal(result.data.meta.modeUsed, "fresh");
  assert.equal(result.data.meta.usedPreferenceContext, false);
});
