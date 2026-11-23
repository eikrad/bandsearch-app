import test from "node:test";
import assert from "node:assert/strict";
import { fakeDesktopApp } from "./helpers/fakeApp.js";
import { chatViewProps } from "./helpers/fakeViewProps.js";
import { BandsearchHttpError } from "../src/chatClient.js";
import type { ChatStateMessage } from "../src/domain.js";
import { bootstrapDesktopReactShell } from "../src/index.js";
import { createDesktopReactShell } from "../src/ui/createDesktopReactShell.js";
import { createDesktopReactMount } from "../src/ui/mountDesktopReactApp.js";
import { fakeContainer, fakeReactRoot } from "./helpers/fakeDom.js";
import type { ReactElement } from "react";
import type { Route } from "../src/createHashRouter.js";

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
      saveBand: async (target) => {
        calls.push({ type: "save", artistName: target.name });
      },
      rateBand: async (target, rating) => {
        calls.push({ type: "rate", artistName: target.name, rating });
      },
    }),
  });

  await shell.saveBand({ name: "Fen" });
  const afterSave = shell.getViewProps();
  await shell.rateBand({ name: "Fen" }, 5);
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
  assert.match(props.actionStatus?.message, /Settings|API key/i);
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

  await shell.saveBand({ name: "Fen" });
  assert.equal(shell.getViewProps().actionStatus?.message, "Saved Fen.");
  scheduled();
  assert.equal(shell.getViewProps().actionStatus, null);
});

test("createDesktopReactShell sends Stop and Retry to the render adapter", async () => {
  let cancelled = false;
  let retried = false;
  const shell = createDesktopReactShell({
    renderAdapter: {
      onModeChange: () => {},
      onSubmitQuery: async () => {},
      onCancelSearch: () => { cancelled = true; },
      onRetrySearch: async () => { retried = true; },
      getViewProps: () => chatViewProps({ modeValue: "fresh", modeOptions: [], isLoading: false, queryDisabled: false, queryPlaceholder: "", cards: [], actionStatus: null }),
    },
  });

  shell.cancelSearch();
  assert.equal(cancelled, true, "Stop reaches the adapter");

  await shell.retryLastSearch();
  assert.equal(retried, true, "Retry reaches the adapter");
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

// #311: the shell cleared the status on its timer, but nothing repainted, so
// "Saved Fen." stayed on screen until the next click. Driven through the real
// mount: what matters is what was painted, not what the shell holds.
function statusRepaintHarness() {
  let route: Route = "home";
  const routeListeners: Array<() => void> = [];
  let fireTimer: () => void = () => {};
  const shell = createDesktopReactShell({
    renderAdapter: {
      getViewProps: () => chatViewProps({
        headerTitle: "Bandsearch",
        headerSubtitle: "",
        viewport: "desktop",
        modeValue: "fresh",
        modeOptions: [],
        queryPlaceholder: "",
        queryDisabled: false,
        cards: [],
      }),
      onModeChange: () => ({}),
      onSubmitQuery: async () => ({}),
    },
    actionHandlers: { onSave: async () => ({}) },
    setTimeoutImpl: (fn) => {
      fireTimer = fn;
      return 1;
    },
  });
  const painted: unknown[] = [];
  const mount = createDesktopReactMount({
    shell,
    router: {
      getRoute: () => route,
      // A router tells its listeners inside navigate(); the mount renders from that.
      navigate: (next) => { route = next; routeListeners.forEach((fn) => fn()); },
      onRouteChange: (fn) => { routeListeners.push(fn); },
    },
    getSettingsViewProps: () => ({ statusMessage: null }),
    createRootImpl: () => fakeReactRoot((element) => {
      // The mount paints a Fragment: [update banner | null, routed view].
      const children = (element as ReactElement<{ children: ReactElement<{ viewProps: unknown }>[] }>).props.children;
      painted.push(children[1].props.viewProps);
    }),
    resolveContainer: () => fakeContainer({ id: "root" }),
  });
  return { mount, painted, fireTimer: () => fireTimer() };
}

test("a cleared status message is repainted on the chat screen", async () => {
  const { mount, painted, fireTimer } = statusRepaintHarness();
  await mount.handlers.onSave({ name: "Fen", musicbrainzArtistId: "mb-fen" });
  assert.deepEqual((painted.at(-1) as { actionStatus: unknown }).actionStatus, { type: "success", message: "Saved Fen." });

  fireTimer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal((painted.at(-1) as { actionStatus: unknown }).actionStatus, null, "the message is gone from the screen");
});

test("a status clearing while another screen is shown does not repaint that screen", async () => {
  const { mount, painted, fireTimer } = statusRepaintHarness();
  await mount.handlers.onSave({ name: "Fen", musicbrainzArtistId: "mb-fen" });
  await mount.handlers.onNavigateSettings();
  const paintsBefore = painted.length;

  fireTimer();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(painted.length, paintsBefore, "settings is not re-rendered (it would repeat its IPC)");
});

test("a failed save stays on screen for the error timeout, not the confirmation one", async () => {
  // UI_GUIDELINES: a confirmation clears after 3 s, an error after 10.
  const delays: number[] = [];
  const shell = createDesktopReactShell({
    renderAdapter: {
      getViewProps: () => chatViewProps({ modeValue: "fresh", modeOptions: [], cards: [] }),
      onModeChange: () => ({}),
      onSubmitQuery: async () => ({}),
    },
    actionHandlers: {
      onSave: async () => { throw new Error("offline"); },
      onRate: async () => { throw new Error("offline"); },
      onUnsave: async () => { throw new Error("offline"); },
      onSaveCategoryNote: async () => { throw new Error("offline"); },
    },
    setTimeoutImpl: (_fn, ms) => { delays.push(ms); return 1; },
  });

  await shell.saveBand({ name: "Fen" }).catch(() => {});
  await shell.rateBand({ name: "Fen" }, 4).catch(() => {});
  await shell.unsaveBand("b1", "Fen").catch(() => {});
  await shell.saveCategoryNote({ name: "Fen" }, { note: "x" }).catch(() => {});

  assert.deepEqual(delays, [10000, 10000, 10000, 10000]);
});
