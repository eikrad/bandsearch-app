const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapDesktopApp } = require("../src/index");

function createStubFetch({ sessionId = "sess-1", recommendations = [] } = {}) {
  return async (url, init) => {
    const method = init?.method || "GET";
    if (url.includes("/sessions") && method === "POST" && !url.match(/sessions\/[^/]+\/messages/)) {
      return {
        ok: true,
        json: async () => ({ session: { id: sessionId, title: "Test", createdAt: "2026-01-01T00:00:00Z" } }),
      };
    }
    if (url.match(/sessions\/[^/]+\/messages/) && method === "POST") {
      const body = JSON.parse(init?.body || "{}");
      return {
        ok: true,
        json: async () => ({ message: { id: `msg-${Date.now()}`, ...body } }),
      };
    }
    if (url.includes("/sessions") && method === "GET") {
      return {
        ok: true,
        json: async () => ({ sessions: [{ id: sessionId, title: "Test" }] }),
      };
    }
    if (url.includes("/recommendations")) {
      return {
        ok: true,
        json: async () => ({ recommendations, meta: { modeUsed: "fresh", usedPreferenceContext: false } }),
      };
    }
    return { ok: true, json: async () => ({}) };
  };
}

test("app.startSession creates a session and stores id in state", async () => {
  const app = bootstrapDesktopApp({ fetchImpl: createStubFetch({ sessionId: "sess-42" }) });

  await app.startSession("My test session");
  assert.equal(app.getState().currentSessionId, "sess-42");
});

test("app.listSessions returns session list from API", async () => {
  const app = bootstrapDesktopApp({ fetchImpl: createStubFetch({ sessionId: "sess-1" }) });

  const sessions = await app.listSessions();
  assert.equal(Array.isArray(sessions), true);
  assert.equal(sessions.length >= 1, true);
});

test("app tracks user + assistant messages in conversation history", async () => {
  const app = bootstrapDesktopApp({
    fetchImpl: createStubFetch({
      sessionId: "sess-1",
      recommendations: [{ artist: "Fen", why: "test", sourceSignals: ["musicbrainz_search"] }],
    }),
  });

  await app.requestRecommendations("I like atmospheric bands", "fresh");

  const messages = app.getState().messages;
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");

  assert.equal(userMessages.length >= 1, true, "user message tracked");
  assert.equal(assistantMessages.length >= 1, true, "assistant message tracked");
  assert.equal(userMessages[0].content, "I like atmospheric bands");
});
