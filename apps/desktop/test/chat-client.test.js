const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
  normalizeArtistId,
} = require("../src/chatClient");

test("chat client sends recommendation request and returns response payload", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          recommendations: [{ artist: "Fen", why: "Atmospheric overlap", sourceSignals: ["musicbrainz_search"] }],
          assistantReply: "These lean atmospheric — want something heavier next?",
          meta: { modeUsed: "fresh", usedPreferenceContext: false },
        }),
      };
    },
  });

  const result = await client.fetchRecommendations("I like atmospheric post-black", "fresh");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3001/recommendations");
  assert.equal(result.recommendations[0].artist, "Fen");
  assert.equal(result.assistantReply.includes("heavier"), true);
  assert.equal(result.meta.modeUsed, "fresh");
});

test("chat state appends assistant message from recommendation response", () => {
  const initial = createInitialChatState();
  const next = applyAssistantMessage(initial, {
    recommendations: [{ artist: "Alcest", why: "Dreamlike blackgaze", sourceSignals: ["deterministic_fallback"] }],
    assistantReply: "Here are picks in that vein. Prefer more shoegaze or more metal?",
    meta: { modeUsed: "fresh", usedPreferenceContext: false },
  });

  assert.equal(next.messages.length, 1);
  assert.equal(next.messages[0].role, "assistant");
  assert.equal(next.messages[0].content.includes("shoegaze"), true);
  assert.equal(next.messages[0].recommendations[0].artist, "Alcest");
});

test("chat state synthesizes dialogue when API omits assistantReply", () => {
  const afterUser = {
    ...createInitialChatState(),
    messages: [{ role: "user", content: "I like grunge" }],
  };
  const next = applyAssistantMessage(afterUser, {
    recommendations: [{ artist: "Mudhoney", why: "Proto-grunge", sourceSignals: ["agent_reasoning"] }],
    meta: { modeUsed: "fresh", usedPreferenceContext: false },
  });

  assert.equal(next.messages.length, 2);
  assert.equal(next.messages[1].role, "assistant");
  assert.ok(next.messages[1].content.includes("Mudhoney"));
  assert.ok(next.messages[1].content.includes("grunge"));
});

test("chat client creates and updates preferences", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ savedBand: { id: "pref-1", name: "Fen", rating: 4 } }),
      };
    },
  });

  const created = await client.createPreference({
    musicbrainzArtistId: "local-fen",
    name: "Fen",
    rating: 3,
    categories: [],
    note: "Saved.",
  });
  const updated = await client.updatePreference("pref-1", { rating: 4 });

  assert.equal(calls[0].url, "http://localhost:3001/preferences");
  assert.equal(calls[1].url, "http://localhost:3001/preferences/pref-1");
  assert.equal(created.savedBand.id, "pref-1");
  assert.equal(updated.savedBand.rating, 4);
});

test("chat client fetches saved bands from preferences endpoint", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          savedBands: [{ id: "pref-1", name: "Fen", rating: 4 }],
        }),
      };
    },
  });

  const result = await client.fetchSavedBands();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3001/preferences");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(result.savedBands.length, 1);
  assert.equal(result.savedBands[0].name, "Fen");
});

test("chat client searches artists via artist search endpoint", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          artists: [{ id: "mb-1", name: "Fen", score: 100, disambiguation: "" }],
        }),
      };
    },
  });

  const result = await client.searchArtists("fen");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3001/artists/search?query=fen");
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].name, "Fen");
});

test("chat client creates a new session", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        json: async () => ({
          session: { id: "sess-1", title: "Post-black", createdAt: "2026-01-01T00:00:00Z" },
        }),
      };
    },
  });

  const result = await client.createSession("Post-black");
  assert.equal(calls[0].url, "http://localhost:3001/sessions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(result.session.id, "sess-1");
});

test("chat client lists sessions", async () => {
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ sessions: [{ id: "sess-1", title: "Test" }] }),
    }),
  });

  const result = await client.listSessions();
  assert.equal(result.sessions.length, 1);
});

test("chat client appends a message to a session", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ message: { id: "msg-1", role: "user", content: "I like Alcest" } }),
      };
    },
  });

  await client.appendSessionMessage("sess-1", { role: "user", content: "I like Alcest" });
  assert.equal(calls[0].url, "http://localhost:3001/sessions/sess-1/messages");
  assert.equal(calls[0].init.method, "POST");
});

test("chat client sends selectedArtistIds when provided", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ recommendations: [], meta: { modeUsed: "preference-aware", usedPreferenceContext: true } }),
      };
    },
  });

  await client.fetchRecommendations("q", "preference-aware", "", [], ["pref-a", "pref-b"]);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.selectedArtistIds, ["pref-a", "pref-b"]);
});

test("chat client sends priorityContext in recommendations when provided", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          recommendations: [],
          meta: { modeUsed: "fresh", usedPreferenceContext: true },
        }),
      };
    },
  });

  await client.fetchRecommendations("I like Alcest", "fresh", "Priority references: Fen");
  const body = JSON.parse(calls[0].init.body);

  assert.equal(body.priorityContext, "Priority references: Fen");
});

test("chat client sends conversation messages in recommendations request", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ recommendations: [], meta: { modeUsed: "fresh", usedPreferenceContext: false } }),
      };
    },
  });

  const history = [
    { role: "user", content: "I like Alcest" },
    { role: "assistant", content: "Recommended Fen" },
  ];
  await client.fetchRecommendations("More like that", "fresh", "", history);
  const body = JSON.parse(calls[0].init.body);

  assert.ok(Array.isArray(body.messages), "messages in request body");
  assert.equal(body.messages.length, 2);
});

test("normalizeArtistId creates stable local fallback id", () => {
  assert.equal(normalizeArtistId("Alcest"), "local-alcest");
  assert.equal(normalizeArtistId("Les Discrets"), "local-les-discrets");
});

test("chat client fetches saved bands from GET /preferences", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method });
      return {
        ok: true,
        json: async () => ({ savedBands: [{ id: "b1", name: "Fen", rating: 3 }] }),
      };
    },
  });

  const bands = await client.listPreferences();

  assert.equal(calls[0].url, "http://localhost:3001/preferences");
  assert.equal(calls[0].method, undefined);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].name, "Fen");
});

test("chat client deletes a preference via DELETE /preferences/:id", async () => {
  const calls = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method });
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });

  await client.deletePreference("pref-123");

  assert.equal(calls[0].url, "http://localhost:3001/preferences/pref-123");
  assert.equal(calls[0].method, "DELETE");
});

