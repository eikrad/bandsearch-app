import test from "node:test";
import assert from "node:assert/strict";
import {
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
  normalizeArtistId,
} from "../src/chatClient.js";
import type { ChatMessage } from "../src/chatClient.js";
import { jsonResponse } from "./helpers/fakeResponse.js";

type FetchCall = { url: RequestInfo | URL; init?: RequestInit };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(input: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(input);
  assert.ok(isRecord(parsed));
  return parsed;
}

test("chat client sends recommendation request and returns response payload", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
          recommendations: [{ artist: "Fen", why: "Atmospheric overlap", sourceSignals: ["musicbrainz_search"] }],
          assistantReply: "These lean atmospheric — want something heavier next?",
          meta: { modeUsed: "fresh", usedPreferenceContext: false },
        });
    },
  });

  const result = await client.fetchRecommendations("I like atmospheric post-black", "fresh");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3001/recommendations");
  assert.equal(result.recommendations?.[0].artist, "Fen");
  assert.equal(result.assistantReply?.includes("heavier"), true);
  assert.equal(result.meta?.modeUsed, "fresh");
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
  assert.equal(next.messages[0].recommendations?.[0].artist, "Alcest");
});

test("chat state synthesizes dialogue when API omits assistantReply", () => {
  const afterUser = {
    ...createInitialChatState(),
    messages: [{ role: "user", content: "I like grunge" }] satisfies ChatMessage[],
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
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ savedBand: { id: "pref-1", name: "Fen", rating: 4 } });
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

test("chat client rejects malformed create preference responses", async () => {
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async () => jsonResponse({ savedBand: { id: "pref-1" } }),
  });

  await assert.rejects(
    client.createPreference({ name: "Fen" }),
    /invalid create preference response: savedBand must be a valid saved band/,
  );
});

test("chat client rejects malformed update preference responses", async () => {
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async () => jsonResponse({ savedBand: null }),
  });

  await assert.rejects(
    client.updatePreference("pref-1", { rating: 4 }),
    /invalid update preference response: savedBand must be a valid saved band/,
  );
});

test("chat client rejects malformed preference lists", async () => {
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async () => jsonResponse({ savedBands: [{ id: "pref-1", name: 42 }] }),
  });

  await assert.rejects(
    client.listPreferences(),
    /invalid list preferences response: savedBands must be an array of valid saved bands/,
  );
});

test("chat client fetches saved bands from preferences endpoint", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
          savedBands: [{ id: "pref-1", name: "Fen", rating: 4 }],
        });
    },
  });

  const result = await client.fetchSavedBands();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3001/preferences");
  assert.equal(calls[0].init?.method, "GET");
  assert.equal(result.savedBands.length, 1);
  assert.equal(result.savedBands[0].name, "Fen");
});

test("chat client rejects malformed saved bands responses", async () => {
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async () => jsonResponse({ savedBands: [{ id: "pref-1", name: 42 }] }),
  });

  await assert.rejects(
    client.fetchSavedBands(),
    /invalid fetch saved bands response: savedBands must be an array of valid saved bands/,
  );
});

test("chat client searches artists via artist search endpoint", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
          artists: [{ id: "mb-1", name: "Fen", score: 100, disambiguation: "" }],
        });
    },
  });

  const result = await client.searchArtists("fen");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:3001/artists/search?query=fen");
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].name, "Fen");
});

test("chat client creates a new session", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
          session: { id: "sess-1", title: "Post-black", createdAt: "2026-01-01T00:00:00Z" },
        }, { status: 201 });
    },
  });

  const result = await client.createSession("Post-black");
  assert.equal(calls[0].url, "http://localhost:3001/sessions");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(result.session.id, "sess-1");
});

test("chat client lists sessions", async () => {
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async () => (jsonResponse({ sessions: [{ id: "sess-1", title: "Test" }] })),
  });

  const result = await client.listSessions();
  assert.equal(result.sessions.length, 1);
});

test("chat client appends a message to a session", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ message: { id: "msg-1", role: "user", content: "I like Alcest" } });
    },
  });

  await client.appendSessionMessage("sess-1", { role: "user", content: "I like Alcest" });
  assert.equal(calls[0].url, "http://localhost:3001/sessions/sess-1/messages");
  assert.equal(calls[0].init?.method, "POST");
});

test("chat client sends selectedArtistIds when provided", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ recommendations: [], meta: { modeUsed: "preference-aware", usedPreferenceContext: true } });
    },
  });

  await client.fetchRecommendations("q", "preference-aware", "", [], ["pref-a", "pref-b"]);
  const body = parseJsonObject(String(calls[0].init?.body));
  assert.ok(
    Array.isArray(body.selectedArtistIds) &&
      body.selectedArtistIds.every((id) => typeof id === "string"),
  );
  assert.deepEqual(body.selectedArtistIds, ["pref-a", "pref-b"]);
});

test("chat client sends priorityContext in recommendations when provided", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
          recommendations: [],
          meta: { modeUsed: "fresh", usedPreferenceContext: true },
        });
    },
  });

  await client.fetchRecommendations("I like Alcest", "fresh", "Priority references: Fen");
  const body = parseJsonObject(String(calls[0].init?.body));
  assert.equal(typeof body.priorityContext, "string");

  assert.equal(body.priorityContext, "Priority references: Fen");
});

test("chat client sends conversation messages in recommendations request", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ recommendations: [], meta: { modeUsed: "fresh", usedPreferenceContext: false } });
    },
  });

  const history = [
    { role: "user", content: "I like Alcest" },
    { role: "assistant", content: "Recommended Fen" },
  ];
  await client.fetchRecommendations("More like that", "fresh", "", history);
  const body = parseJsonObject(String(calls[0].init?.body));

  assert.ok(Array.isArray(body.messages), "messages in request body");
  assert.equal(body.messages.length, 2);
});

// ─── Phase 8.3: obscurityTarget ────────────────────────────────────────────

test("chat client includes obscurityTarget in recommendations request body when provided", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
          recommendations: [],
          meta: { modeUsed: "fresh", usedPreferenceContext: false, eventId: "evt-123" },
        });
    },
  });

  await client.fetchRecommendations("dark ambient", "fresh", "", [], [], "underground");
  const body = parseJsonObject(String(calls[0].init?.body));
  assert.equal(typeof body.obscurityTarget, "string");
  assert.equal(body.obscurityTarget, "underground");
});

test("chat client omits obscurityTarget from request body when not provided", async () => {
  const calls: FetchCall[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ recommendations: [], meta: { modeUsed: "fresh" } });
    },
  });

  await client.fetchRecommendations("dark ambient");
  const body = parseJsonObject(String(calls[0].init?.body));
  assert.ok(!("obscurityTarget" in body), "obscurityTarget should not be in body when omitted");
});

test("normalizeArtistId creates stable local fallback id", () => {
  assert.equal(normalizeArtistId("Alcest"), "local-alcest");
  assert.equal(normalizeArtistId("Les Discrets"), "local-les-discrets");
});

test("chat client fetches saved bands from GET /preferences", async () => {
  const calls: Array<{ url: RequestInfo | URL; method?: string }> = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method });
      return jsonResponse({ savedBands: [{ id: "b1", name: "Fen", rating: 3 }] });
    },
  });

  const bands = await client.listPreferences();

  assert.equal(calls[0].url, "http://localhost:3001/preferences");
  assert.equal(calls[0].method, "GET");
  assert.equal(bands.length, 1);
  assert.equal(bands[0].name, "Fen");
});

test("chat client deletes a preference via DELETE /preferences/:id", async () => {
  const calls: Array<{ url: RequestInfo | URL; method?: string }> = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init?.method });
      return jsonResponse({ ok: true });
    },
  });

  await client.deletePreference("pref-123");

  assert.equal(calls[0].url, "http://localhost:3001/preferences/pref-123");
  assert.equal(calls[0].method, "DELETE");
});

test("fetchRecommendations forwards AbortSignal to fetch", async () => {
  let capturedSignal: AbortSignal | null | undefined;
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (url, init) => {
      capturedSignal = init?.signal;
      return jsonResponse({ recommendations: [], meta: {} });
    },
  });

  const controller = new AbortController();
  await client.fetchRecommendations("post-metal", "fresh", "", [], [], undefined, controller.signal);
  assert.equal(capturedSignal, controller.signal, "signal is forwarded to fetch");
});


test("exporting account data requests the full export with the auth token", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://api.test",
    getToken: () => "tok-123",
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ format: "bandsearch-account-export/1" }),
      };
    }) as unknown as typeof fetch,
  });

  await client.exportAccountData();

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/account\/export$/, "hits the full account export, not the artist backup");
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer tok-123", "the export is authenticated");
});
