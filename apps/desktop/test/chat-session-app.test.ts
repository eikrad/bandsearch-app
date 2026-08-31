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
  existingMessages = [],
  notFoundSessionId,
  onRequest,
}: {
  sessionId?: string;
  recommendations?: RecommendationItem[];
  existingMessages?: Array<{ id: string; role: string; content: string; createdAt: string }>;
  notFoundSessionId?: string;
  onRequest?: (url: string, method: string) => void;
} = {}): typeof fetch {
  return async (url, init) => {
    const requestUrl = String(url);
    const method = init?.method || "GET";
    onRequest?.(requestUrl, method);
    if (notFoundSessionId && requestUrl.endsWith(`/sessions/${notFoundSessionId}`) && method === "GET") {
      return jsonResponse({ error: { code: "not_found", message: "session not found" } }, { status: 404 });
    }
    if (requestUrl.match(/\/sessions\/[^/]+$/) && method === "GET") {
      return jsonResponse({
        session: { id: sessionId, title: "Test", createdAt: "2026-01-01T00:00:00Z" },
        messages: existingMessages,
      });
    }
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

test("resumeSession hydrates messages and currentSessionId from a persisted session", async () => {
  const app = bootstrapDesktopApp({
    fetchImpl: createStubFetch({
      sessionId: "sess-1",
      existingMessages: [
        { id: "msg-1", role: "user", content: "I like Alcest", createdAt: "2026-01-01T00:00:00Z" },
        { id: "msg-2", role: "assistant", content: "Try Fen.", createdAt: "2026-01-01T00:00:01Z" },
      ],
    }),
  });

  const resumed = await app.resumeSession("sess-1");

  assert.equal(resumed, true);
  assert.equal(app.getState().currentSessionId, "sess-1");
  assert.deepEqual(
    app.getState().messages.map((m) => ({ role: m.role, content: m.content })),
    [
      { role: "user", content: "I like Alcest" },
      { role: "assistant", content: "Try Fen." },
    ],
  );
});

test("resumeSession returns false and leaves state blank when the session no longer exists", async () => {
  const app = bootstrapDesktopApp({
    fetchImpl: createStubFetch({ notFoundSessionId: "gone" }),
  });

  const resumed = await app.resumeSession("gone");

  assert.equal(resumed, false);
  assert.equal(app.getState().currentSessionId, null);
  assert.deepEqual(app.getState().messages, []);
});

test("requestRecommendations lazily creates a session on the first message and persists both turns", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const app = bootstrapDesktopApp({
    fetchImpl: createStubFetch({
      sessionId: "sess-new",
      recommendations: [{ artist: "Fen", why: "test", sourceSignals: ["musicbrainz_search"] }],
      onRequest: (url, method) => requests.push({ url, method }),
    }),
  });

  assert.equal(app.getState().currentSessionId, null, "no session before the first message");

  await app.requestRecommendations("I like atmospheric bands", "fresh");

  assert.equal(app.getState().currentSessionId, "sess-new");
  const sessionCreatePosts = requests.filter((r) => r.url.endsWith("/sessions") && r.method === "POST");
  assert.equal(sessionCreatePosts.length, 1, "exactly one session created");
  const messagePosts = requests.filter((r) => r.url.includes("/sessions/sess-new/messages") && r.method === "POST");
  assert.equal(messagePosts.length, 2, "both the user and assistant turn were persisted");
});

test("requestRecommendations reuses the resumed session instead of creating a new one", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const app = bootstrapDesktopApp({
    fetchImpl: createStubFetch({
      sessionId: "sess-1",
      recommendations: [],
      onRequest: (url, method) => requests.push({ url, method }),
    }),
  });

  await app.resumeSession("sess-1");
  await app.requestRecommendations("more like that", "fresh");

  const sessionCreatePosts = requests.filter((r) => r.url.endsWith("/sessions") && r.method === "POST");
  assert.equal(sessionCreatePosts.length, 0, "resumed session is reused, not recreated");
});
