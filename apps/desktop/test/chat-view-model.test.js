const test = require("node:test");
const assert = require("node:assert/strict");

const { createChatAppModel } = require("../src/chatAppModel");
const { bootstrapDesktopApp } = require("../src/bootstrapDesktopApp");

test("chat app model tracks mode and sends queries through app interface", async () => {
  const calls = [];
  const vm = createChatAppModel({
    app: {
      requestRecommendations: async (query, mode) => {
        calls.push({ query, mode });
        return {
          recommendations: [
            {
              artist: "Alcest",
              why: "Dreamlike blackgaze overlap",
              sourceSignals: ["musicbrainz_search"],
            },
          ],
          meta: { modeUsed: mode, usedPreferenceContext: mode === "preference-aware" },
        };
      },
      getState: () => ({ messages: [], savedBands: [] }),
    },
  });

  vm.setMode("preference-aware");
  await vm.submitQuery("I like blackgaze");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, "preference-aware");
  assert.equal(vm.getLastMeta().modeUsed, "preference-aware");
});

test("chat app model formats recommendation list for rendering", () => {
  const appState = {
    savedBands: [{ id: "pref-1", name: "Fen", rating: 4 }],
    messages: [
      {
        role: "assistant",
        content: "",
        recommendations: [
          { artist: "Fen", why: "Post-metal atmosphere", sourceSignals: ["deterministic_fallback"] },
        ],
        meta: { modeUsed: "fresh", usedPreferenceContext: false },
      },
    ],
  };
  const vm = createChatAppModel({
    app: {
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => appState,
    },
  });

  const conversation = vm.getConversation();
  assert.ok(conversation, "conversation is non-null");
  const cards = conversation[0].cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "Fen");
  assert.ok(cards[0].why.includes("Post-metal"), "why field preserved");
  assert.equal(cards[0].rating, 4, "rating extracted from savedBand join");
  assert.equal(cards[0].saved, true, "saved flag set");
});

test("chat app model includes assistant prose in conversation thread", () => {
  const vm = createChatAppModel({
    app: {
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({
        savedBands: [],
        messages: [
          { role: "user", content: "I like grunge" },
          {
            role: "assistant",
            content: "Try these — prefer more punk edge or slower sludge?",
            recommendations: [{ artist: "Mudhoney", why: "Proto-grunge fuzz", sourceSignals: ["agent_reasoning"] }],
            meta: { modeUsed: "fresh", usedPreferenceContext: false },
          },
        ],
      }),
    },
  });

  const thread = vm.getConversation();
  assert.ok(thread, "conversation is non-null");
  assert.equal(thread[1].role, "assistant");
  assert.ok(thread[1].content.includes("punk edge"), "assistant prose preserved");
  assert.equal(thread[1].cards[0].title, "Mudhoney");
});

// ─── Phase 8.3b: obscurityTarget state ──────────────────────────────────────

test("chatAppModel defaults obscurityTarget to 'underground'", () => {
  const vm = createChatAppModel({
    app: { requestRecommendations: async () => ({ recommendations: [], meta: {} }), getState: () => ({ messages: [], savedBands: [] }) },
  });
  assert.equal(vm.getObscurityTarget(), "underground");
});

test("chatAppModel setObscurityTarget updates the target", () => {
  const vm = createChatAppModel({
    app: { requestRecommendations: async () => ({ recommendations: [], meta: {} }), getState: () => ({ messages: [], savedBands: [] }) },
  });
  vm.setObscurityTarget("obscure");
  assert.equal(vm.getObscurityTarget(), "obscure");
});

test("chatAppModel passes obscurityTarget to requestRecommendations", async () => {
  const calls = [];
  const vm = createChatAppModel({
    app: {
      requestRecommendations: async (query, mode, obscurityTarget) => {
        calls.push({ query, mode, obscurityTarget });
        return { recommendations: [], meta: {} };
      },
      getState: () => ({ messages: [], savedBands: [] }),
    },
  });
  vm.setObscurityTarget("cult");
  await vm.submitQuery("dark drone");
  assert.equal(calls[0].obscurityTarget, "cult");
});

test("bootstrapDesktopApp.cancelSearch aborts in-flight requestRecommendations and rolls back user message", async () => {
  const app = bootstrapDesktopApp({
    fetchImpl: async (url, init) => {
      // Simulate slow server — never resolves until aborted
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    },
  });

  const pending = app.requestRecommendations("drone metal", "fresh").catch(() => {});
  // Give the fetch a tick to register
  await new Promise((r) => setTimeout(r, 0));
  app.cancelSearch();
  await pending;

  const state = app.getState();
  assert.equal(state.messages.length, 0, "optimistic user message removed after abort");
});

test("bootstrapDesktopApp.cancelSearch is a no-op when idle", () => {
  const app = bootstrapDesktopApp({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ recommendations: [], meta: {} }) }),
  });
  // Should not throw
  assert.doesNotThrow(() => app.cancelSearch());
});
