import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDesktopApp } from "../src/index.js";
import type { RecommendationItem } from "../src/domain.js";
import { jsonResponse } from "./helpers/fakeResponse.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(input: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(input);
  assert.ok(isRecord(parsed));
  return parsed;
}

function createStubFetch({
  sessionId = "sess-1",
  recommendations = [],
}: {
  sessionId?: string;
  recommendations?: RecommendationItem[];
} = {}): typeof fetch {
  return async (url, init) => {
    const requestUrl = String(url);
    const method = init?.method || "GET";
    if (requestUrl.includes("/sessions") && method === "POST" && !requestUrl.match(/sessions\/[^/]+\/messages/)) {
      return jsonResponse({ session: { id: sessionId, title: "Test", createdAt: "2026-01-01T00:00:00Z" } });
    }
    if (requestUrl.match(/sessions\/[^/]+\/messages/) && method === "POST") {
      const body = parseJsonObject(String(init?.body || "{}"));
      return jsonResponse({ message: { id: `msg-${Date.now()}`, ...body } });
    }
    if (requestUrl.includes("/sessions") && method === "GET") {
      return jsonResponse({ sessions: [{ id: sessionId, title: "Test" }] });
    }
    if (requestUrl.includes("/recommendations")) {
      return jsonResponse({ recommendations, meta: { modeUsed: "fresh", usedPreferenceContext: false } });
    }
    return jsonResponse({});
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
