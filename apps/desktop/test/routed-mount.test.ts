import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import {
  createDesktopReactMount,
  type DesktopReactMountOptions,
} from "../src/ui/mountDesktopReactApp.js";
import { fakeContainer } from "./helpers/fakeDom.js";

type MountShell = DesktopReactMountOptions["shell"];
type MountRouter = NonNullable<DesktopReactMountOptions["router"]>;
type SavedArtistsShell = NonNullable<DesktopReactMountOptions["savedArtistsShell"]>;

function makeShell(overrides: Partial<MountShell> = {}): MountShell {
  return {
    getViewProps: () => ({
      headerTitle: "Bandsearch",
      headerSubtitle: "Niche recommendations",
      viewport: "desktop",
      modeValue: "fresh",
      modeOptions: [{ value: "fresh", label: "Fresh" }],
      queryPlaceholder: "Describe bands...",
      queryDisabled: false,
      cards: [],
    }),
    updateMode: async () => {},
    submitQuery: async () => {},
    saveBand: async () => {},
    rateBand: async () => {},
    ...overrides,
  };
}

function makeRouter(initialRoute = "home"): MountRouter {
  let route = initialRoute;
  const callbacks: Array<(route: string) => void> = [];
  return {
    getRoute: () => route,
    navigate: (r: string) => {
      route = r;
      callbacks.forEach((fn) => fn(r));
    },
    onRouteChange: (fn: () => void) => {
      callbacks.push(fn);
      return () => {};
    },
  };
}

function makeSavedArtistsShell(overrides: Partial<SavedArtistsShell> = {}): SavedArtistsShell {
  return {
    getViewProps: () => ({
      savedArtists: [],
      selectedIds: [],
      searchQuery: "",
      searchResults: [],
      isSearching: false,
    }),
    toggleArtistSelection: () => {},
    setSearchQuery: () => {},
    searchArtists: async () => {},
    addArtist: async () => {},
    ...overrides,
  };
}

test("routed mount calls render with SavedArtistsView when route is saved", async () => {
  const renders: ReactElement[] = [];
  const shell = makeShell();
  const router = makeRouter("saved");
  const savedShell = makeSavedArtistsShell();

  const fakeRoot = {
    render: (element) => renders.push(element),
  };

  const mount = createDesktopReactMount({
    shell,
    router,
    savedArtistsShell: savedShell,
    createRootImpl: () => fakeRoot,
    resolveContainer: () => fakeContainer(),
  });

  await mount.mount();

  assert.equal(renders.length, 1);
  assert.equal(renders[0].type?.name, "SavedArtistsView");
});

test("routed mount calls render with ChatAppView when route is home", async () => {
  const renders: ReactElement[] = [];
  const shell = makeShell();
  const router = makeRouter("home");
  const savedShell = makeSavedArtistsShell();

  const fakeRoot = { render: (el) => renders.push(el) };

  const mount = createDesktopReactMount({
    shell,
    router,
    savedArtistsShell: savedShell,
    createRootImpl: () => fakeRoot,
    resolveContainer: () => fakeContainer(),
  });

  await mount.mount();

  assert.equal(renders.length, 1);
  assert.equal(renders[0].type?.name, "ChatAppView");
});

test("routed mount calls render with WelcomeView when route is welcome", async () => {
  const renders: ReactElement[] = [];
  const shell = makeShell();
  const router = makeRouter("welcome");
  const savedShell = makeSavedArtistsShell();

  const fakeRoot = { render: (el) => renders.push(el) };

  const mount = createDesktopReactMount({
    shell,
    router,
    savedArtistsShell: savedShell,
    createRootImpl: () => fakeRoot,
    resolveContainer: () => fakeContainer(),
  });

  await mount.mount();

  assert.equal(renders.length, 1);
  assert.equal(renders[0].type?.name, "WelcomeView");
});

test("routed mount calls render with SettingsView when route is settings", async () => {
  const renders: ReactElement[] = [];
  const shell = makeShell();
  const router = makeRouter("settings");
  const savedShell = makeSavedArtistsShell();

  const fakeRoot = { render: (el) => renders.push(el) };

  const mount = createDesktopReactMount({
    shell,
    router,
    savedArtistsShell: savedShell,
    getSettingsViewProps: () => ({
      headerTitle: "Settings",
      hasStoredKey: false,
      statusMessage: null,
    }),
    createRootImpl: () => fakeRoot,
    resolveContainer: () => fakeContainer(),
  });

  await mount.mount();

  assert.equal(renders.length, 1);
  assert.equal(renders[0].type?.name, "SettingsView");
});

test("routed mount settingsHandlers.onSaveTursoConfig calls provided saveTursoConfig", async () => {
  const calls: Array<{ url: string; token: string }> = [];
  const shell = makeShell();
  const router = makeRouter("settings");

  const mount = createDesktopReactMount({
    shell,
    router,
    getSettingsViewProps: () => ({ headerTitle: "Settings", hasStoredKey: false }),
    saveTursoConfig: async (url, token) => { calls.push({ url, token }); },
    createRootImpl: () => ({ render: () => {} }),
    resolveContainer: () => fakeContainer(),
  });

  await mount.handlers.onSaveTursoConfig("libsql://test.turso.io", "mytoken");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "libsql://test.turso.io");
  assert.equal(calls[0].token, "mytoken");
});
