import test from "node:test";
import assert from "node:assert/strict";
import {
  createChatAppModel,
  type ChatAppCollaborator,
} from "../src/chatAppModel.js";
import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { jsonResponse } from "./helpers/fakeResponse.js";

type QueryCall = {
  query: string;
  mode: string;
  obscurityTarget?: string;
};

test("chat app model tracks mode and sends queries through app interface", async () => {
  const calls: QueryCall[] = [];
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
  const appState: ReturnType<ChatAppCollaborator["getState"]> = {
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
  const first = conversation[0];
  assert.ok(first.role === "assistant", "first conversation entry is the assistant reply");
  const cards = first.cards;
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
  const calls: QueryCall[] = [];
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
      return new Promise<Response>((_resolve, reject) => {
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

test("chatAppModel.retryLastSearch re-runs the last query with same mode and obscurityTarget", async () => {
  const calls: QueryCall[] = [];
  const vm = createChatAppModel({
    app: {
      requestRecommendations: async (query, mode, obscurityTarget) => {
        calls.push({ query, mode, obscurityTarget });
        return { recommendations: [], meta: { modeUsed: mode } };
      },
      getState: () => ({ messages: [], savedBands: [] }),
      cancelSearch: () => {},
    },
  });

  vm.setMode("preference-aware");
  vm.setObscurityTarget("obscure");
  await vm.submitQuery("doom jazz");
  assert.equal(calls.length, 1);

  await vm.retryLastSearch();
  assert.equal(calls.length, 2, "retryLastSearch called requestRecommendations again");
  assert.equal(calls[1].query, "doom jazz", "same query reused");
  assert.equal(calls[1].mode, "preference-aware", "mode preserved");
  assert.equal(calls[1].obscurityTarget, "obscure", "obscurityTarget preserved");
});

test("chatAppModel.retryLastSearch is a no-op when lastQuery is empty", async () => {
  const calls = [];
  const vm = createChatAppModel({
    app: {
      requestRecommendations: async () => { calls.push(1); return { recommendations: [], meta: {} }; },
      getState: () => ({ messages: [], savedBands: [] }),
      cancelSearch: () => {},
    },
  });

  await vm.retryLastSearch();
  assert.equal(calls.length, 0, "no-op when no previous query");
});

test("chatAppModel.submitQuery swallows AbortError and resets loadingState", async () => {
  let rejectWithAbort: (reason?: unknown) => void = () => {
    throw new Error("rejectWithAbort called before the search promise was created");
  };
  const vm = createChatAppModel({
    app: {
      requestRecommendations: async () => {
        return new Promise<{ meta?: Record<string, never> }>((_resolve, reject) => {
          rejectWithAbort = reject;
        });
      },
      getState: () => ({ messages: [], savedBands: [] }),
      cancelSearch: () => {},
    },
  });

  const pending = vm.submitQuery("drone");
  assert.equal(vm.isLoading(), true, "loading while in-flight");
  rejectWithAbort(new DOMException("Aborted", "AbortError"));
  await pending; // should resolve, not reject
  assert.equal(vm.isLoading(), false, "loading cleared after abort");
});

test("bootstrapDesktopApp.cancelSearch is a no-op when idle", () => {
  const app = bootstrapDesktopApp({
    fetchImpl: async () => (jsonResponse({ recommendations: [], meta: {} })),
  });
  // Should not throw
  assert.doesNotThrow(() => app.cancelSearch());
});
