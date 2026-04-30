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
          meta: { modeUsed: "fresh", usedPreferenceContext: false },
        }),
      };
    },
  });

  const result = await client.fetchRecommendations("I like atmospheric post-black", "fresh");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3001/recommendations");
  assert.equal(result.recommendations[0].artist, "Fen");
  assert.equal(result.meta.modeUsed, "fresh");
});

test("chat state appends assistant message from recommendation response", () => {
  const initial = createInitialChatState();
  const next = applyAssistantMessage(initial, {
    recommendations: [{ artist: "Alcest", why: "Dreamlike blackgaze", sourceSignals: ["deterministic_fallback"] }],
    meta: { modeUsed: "fresh", usedPreferenceContext: false },
  });

  assert.equal(next.messages.length, 1);
  assert.equal(next.messages[0].role, "assistant");
  assert.equal(next.messages[0].recommendations[0].artist, "Alcest");
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

test("normalizeArtistId creates stable local fallback id", () => {
  assert.equal(normalizeArtistId("Alcest"), "local-alcest");
  assert.equal(normalizeArtistId("Les Discrets"), "local-les-discrets");
});
