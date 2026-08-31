import test from "node:test";
import assert from "node:assert/strict";
import { fakeDesktopApp } from "./helpers/fakeApp.js";
import { chatViewProps } from "./helpers/fakeViewProps.js";
import { BandsearchHttpError } from "../src/chatClient.js";
import type { ChatStateMessage } from "../src/domain.js";
import { bootstrapDesktopReactShell } from "../src/index.js";
import { createDesktopReactShell } from "../src/ui/createDesktopReactShell.js";

test("desktop react shell renders HTML with recommendation card and actions", async () => {
  const appState: { messages: ChatStateMessage[] } = { messages: [] };
  const shell = bootstrapDesktopReactShell({
    app: fakeDesktopApp({
      requestRecommendations: async () => {
        appState.messages = [
          {
            role: "assistant",
            recommendations: [
              {
                artist: "Fen",
                why: "Atmospheric overlap",
                sourceSignals: ["musicbrainz_search"],
              },
            ],
            meta: { modeUsed: "fresh", usedPreferenceContext: false },
          },
        ];
        return { recommendations: appState.messages[0].recommendations, meta: appState.messages[0].meta };
      },
      getState: () => appState,
    }),
  });

  await shell.submitQuery("I like post-black metal");
  const html = shell.renderHtml();
  assert.equal(html.includes("Fen"), true);
  assert.equal(html.includes("Save"), true);
  assert.equal(html.includes("Rate"), true);
  assert.equal(html.includes("···"), true);
});

test("desktop react shell save and rate actions call app handlers", async () => {
  const calls: Array<{ type: string; artistName: string; rating?: number | null }> = [];
  const shell = bootstrapDesktopReactShell({
    app: fakeDesktopApp({
      requestRecommendations: async () => ({ recommendations: [], meta: { modeUsed: "fresh" } }),
      getState: () => ({ messages: [] }),
      saveBand: async (artistName) => {
        calls.push({ type: "save", artistName });
      },
      rateBand: async (artistName, rating) => {
        calls.push({ type: "rate", artistName, rating });
      },
    }),
  });

  await shell.saveBand("Fen");
  const afterSave = shell.getViewProps();
  await shell.rateBand("Fen", 5);
  const afterRate = shell.getViewProps();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].type, "save");
  assert.equal(calls[1].type, "rate");
  assert.equal(calls[1].rating, 5);
  assert.equal(afterSave.actionStatus?.message, "Saved Fen.");
  assert.equal(afterRate.actionStatus?.message, "Rated Fen: 5/5.");
});

test("desktop react shell maps BandsearchHttpError to a human recommendation error banner", async () => {
  const shell = createDesktopReactShell({
    renderAdapter: {
      getViewProps: () => chatViewProps({
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [],
      }),
      onModeChange: () => ({}),
      onSubmitQuery: async () => {
        throw new BandsearchHttpError("recommendation service unavailable", {
          status: 502,
          code: "recommendation_unavailable",
        });
      },
    },
  });

  await assert.rejects(() => shell.submitQuery("metal"), /query failed/);
  const props = shell.getViewProps();
  assert.equal(props.actionStatus?.type, "error");
  assert.match(props.actionStatus?.message, /Settings|API key|Gemini/i);
});

test("desktop react shell clears action status after timeout", async () => {
  let scheduled: () => void = () => {
    throw new Error("scheduled callback invoked before setTimeoutImpl ran");
  };
  const shell = createDesktopReactShell({
    renderAdapter: {
      getViewProps: () => chatViewProps({
        headerTitle: "Bandsearch",
        headerSubtitle: "Niche recommendations",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [],
        queryPlaceholder: "Describe bands...",
        queryDisabled: false,
        cards: [],
      }),
      onModeChange: () => ({}),
      onSubmitQuery: async () => ({}),
    },
    actionHandlers: {
      onSave: async () => ({}),
    },
    statusTimeoutMs: 10,
    setTimeoutImpl: (fn) => {
      scheduled = fn;
      return 1;
    },
  });

  await shell.saveBand("Fen");
  assert.equal(shell.getViewProps().actionStatus?.message, "Saved Fen.");
  scheduled();
  assert.equal(shell.getViewProps().actionStatus, null);
});

test("createDesktopReactShell exposes cancelSearch and retryLastSearch from provided impls", async () => {
  let cancelled = false;
  let retried = false;
  const shell = createDesktopReactShell({
    renderAdapter: {
      onModeChange: () => {},
      onSubmitQuery: async () => {},
      getViewProps: () => chatViewProps({ modeValue: "fresh", modeOptions: [], isLoading: false, queryDisabled: false, queryPlaceholder: "", cards: [], actionStatus: null }),
    },
    cancelSearchImpl: () => { cancelled = true; },
    retryLastSearchImpl: () => { retried = true; },
  });

  shell.cancelSearch();
  assert.equal(cancelled, true, "cancelSearch delegates to impl");

  await shell.retryLastSearch();
  assert.equal(retried, true, "retryLastSearch delegates to impl");
});

// ─── Phase 8.3b: ObscurityTargetPicker rendered in shell ─────────────────────

test("desktop react shell renderHtml includes all three obscurity picker buttons", () => {
  const shell = createDesktopReactShell({
    renderAdapter: {
      onModeChange: () => {},
      onSubmitQuery: async () => {},
      onObscurityTargetChange: () => {},
      getViewProps: () => chatViewProps({
        headerTitle: "Bandsearch",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [],
        isLoading: false,
        queryPlaceholder: "...",
        queryDisabled: false,
        cards: [],
        obscurityTarget: "underground",
      }),
    },
  });
  const html = shell.renderHtml();
  assert.ok(html.includes("Cult Following"), "missing Cult Following button");
  assert.ok(html.includes("Underground"), "missing Underground button");
  assert.ok(html.includes("Truly Obscure"), "missing Truly Obscure button");
});
