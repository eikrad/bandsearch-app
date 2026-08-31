import test from "node:test";
import assert from "node:assert/strict";
import type { ReactNode } from "react";
import { createDesktopReactMount } from "../src/ui/mountDesktopReactApp.js";
import type { MountShell } from "../src/ui/mountDesktopReactApp.js";
import { fakeContainer, fakeReactRoot } from "./helpers/fakeDom.js";

test("desktop react mount renders and wires interaction callbacks", async () => {
  const calls: Array<{ type: string; element?: ReactNode; mode?: string; query?: string; artistName?: string; rating?: number | null }> = [];
  const fakeRoot = fakeReactRoot((element) => {
    calls.push({ type: "render", element });
  });
  const fakeCreateRoot = () => fakeRoot;
  const container = fakeContainer();

  const shell: MountShell = {
    getViewProps: () => ({
      headerTitle: "Bandsearch",
      headerSubtitle: "Niche recommendations",
      modeValue: "fresh",
      modeOptions: [{ value: "fresh", label: "Fresh search" }],
      queryPlaceholder: "Describe bands...",
      queryDisabled: false,
      cards: [],
      emptyText: "No recommendations yet.",
    }),
    updateMode: async (mode) => calls.push({ type: "mode", mode }),
    submitQuery: async (query) => calls.push({ type: "query", query }),
    saveBand: async (artistName) => calls.push({ type: "save", artistName }),
    rateBand: async (artistName, rating) => calls.push({ type: "rate", artistName, rating }),
  };

  const mount = createDesktopReactMount({
    shell,
    createRootImpl: fakeCreateRoot,
    resolveContainer: () => container,
  });

  mount.mount();
  assert.equal(calls[0].type, "render");

  await mount.handlers.onModeChange("preference-aware");
  await mount.handlers.onQuerySubmit("I like blackgaze");
  await mount.handlers.onSave("Fen");
  await mount.handlers.onRate("Fen", 4);

  assert.equal(calls.some((item) => item.type === "mode"), true);
  assert.equal(calls.some((item) => item.type === "query"), true);
  assert.equal(calls.some((item) => item.type === "save"), true);
  assert.equal(calls.some((item) => item.type === "rate"), true);
});

test("onSave re-renders even when shell.saveBand rejects, so a failed save is not silently invisible", async () => {
  const renders: ReactNode[] = [];
  const fakeRoot = fakeReactRoot((element) => renders.push(element));
  const container = fakeContainer();

  const shell: MountShell = {
    getViewProps: () => ({ actionStatus: renders.length > 1 ? { type: "error", message: "Save failed for Fen." } : null }),
    updateMode: async () => {},
    submitQuery: async () => {},
    saveBand: async () => {
      throw new Error("network error");
    },
  };

  const mount = createDesktopReactMount({
    shell,
    createRootImpl: () => fakeRoot,
    resolveContainer: () => container,
  });

  mount.mount();
  const rendersBeforeSave = renders.length;

  await mount.handlers.onSave("Fen");

  assert.ok(renders.length > rendersBeforeSave, "a render happened after the rejected save");
});

test("onRate re-renders even when shell.rateBand rejects, so a failed rating is not silently invisible", async () => {
  const renders: ReactNode[] = [];
  const fakeRoot = fakeReactRoot((element) => renders.push(element));
  const container = fakeContainer();

  const shell: MountShell = {
    getViewProps: () => ({}),
    updateMode: async () => {},
    submitQuery: async () => {},
    rateBand: async () => {
      throw new Error("network error");
    },
  };

  const mount = createDesktopReactMount({
    shell,
    createRootImpl: () => fakeRoot,
    resolveContainer: () => container,
  });

  mount.mount();
  const rendersBeforeRate = renders.length;

  await mount.handlers.onRate("Fen", 4);

  assert.ok(renders.length > rendersBeforeRate, "a render happened after the rejected rating");
});

test("onUnsave calls shell.unsaveBand and re-renders even when it rejects", async () => {
  const renders: ReactNode[] = [];
  const calls: Array<{ savedBandId: string; artistName: string }> = [];
  const shell: MountShell = {
    getViewProps: () => ({}),
    updateMode: async () => {},
    submitQuery: async () => {},
    unsaveBand: async (savedBandId, artistName) => {
      calls.push({ savedBandId, artistName });
      throw new Error("network error");
    },
  };

  const mount = createDesktopReactMount({
    shell,
    createRootImpl: () => fakeReactRoot((element) => renders.push(element)),
    resolveContainer: () => fakeContainer(),
  });

  mount.mount();
  const rendersBeforeUnsave = renders.length;
  await mount.handlers.onUnsave("band-1", "Fen");

  assert.deepEqual(calls, [{ savedBandId: "band-1", artistName: "Fen" }]);
  assert.ok(renders.length > rendersBeforeUnsave, "a render happened after the rejected unsave");
});

test("onSaveCategoryNote calls shell.saveCategoryNote and re-renders even when it rejects", async () => {
  const renders: ReactNode[] = [];
  const calls: Array<{ artistName: string; savedBandId: string | null; updates: { categories: string[]; note: string } }> = [];
  const shell: MountShell = {
    getViewProps: () => ({}),
    updateMode: async () => {},
    submitQuery: async () => {},
    saveCategoryNote: async (artistName, savedBandId, updates) => {
      calls.push({ artistName, savedBandId, updates });
      throw new Error("network error");
    },
  };

  const mount = createDesktopReactMount({
    shell,
    createRootImpl: () => fakeReactRoot((element) => renders.push(element)),
    resolveContainer: () => fakeContainer(),
  });

  mount.mount();
  const rendersBeforeSave = renders.length;
  await mount.handlers.onSaveCategoryNote("Fen", "band-1", { categories: ["blackgaze"], note: "My words" });

  assert.deepEqual(calls, [{ artistName: "Fen", savedBandId: "band-1", updates: { categories: ["blackgaze"], note: "My words" } }]);
  assert.ok(renders.length > rendersBeforeSave, "a render happened after the rejected save");
});

test("onOpenLink routes through the injected opener instead of a plain <a> navigation", () => {
  const opened: string[] = [];
  const container = fakeContainer();
  const shell: MountShell = {
    getViewProps: () => ({}),
    updateMode: async () => {},
    submitQuery: async () => {},
  };

  const mount = createDesktopReactMount({
    shell,
    createRootImpl: () => fakeReactRoot(() => {}),
    resolveContainer: () => container,
    openExternalLinkImpl: (url) => opened.push(url),
  });

  mount.mount();
  mount.handlers.onOpenLink("https://bandcamp.com/search?q=Fen");

  assert.deepEqual(opened, ["https://bandcamp.com/search?q=Fen"]);
});

test("createDesktopReactMount exposes onStop handler that calls shell.cancelSearch", async () => {
  let cancelled = false;
  const mountApi = createDesktopReactMount({
    shell: {
      getViewProps: () => ({ modeValue: "fresh", modeOptions: [], isLoading: false, queryDisabled: false, queryPlaceholder: "", cards: [], actionStatus: null }),
      submitQuery: async () => {},
      updateMode: async () => {},
      cancelSearch: () => { cancelled = true; },
      retryLastSearch: async () => {},
    },
    createRootImpl: () => fakeReactRoot(),
    resolveContainer: () => fakeContainer({ id: "root" }),
  });

  await mountApi.handlers.onStop?.();
  assert.equal(cancelled, true, "onStop calls shell.cancelSearch");
});

test("createDesktopReactMount exposes onRetry handler that calls shell.retryLastSearch", async () => {
  let retried = false;
  const mountApi = createDesktopReactMount({
    shell: {
      getViewProps: () => ({ modeValue: "fresh", modeOptions: [], isLoading: false, queryDisabled: false, queryPlaceholder: "", cards: [], actionStatus: null }),
      submitQuery: async () => {},
      updateMode: async () => {},
      cancelSearch: () => {},
      retryLastSearch: async () => { retried = true; },
    },
    createRootImpl: () => fakeReactRoot(),
    resolveContainer: () => fakeContainer({ id: "root" }),
  });

  await mountApi.handlers.onRetry?.();
  assert.equal(retried, true, "onRetry calls shell.retryLastSearch");
});
