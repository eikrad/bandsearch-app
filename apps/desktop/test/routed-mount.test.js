const test = require("node:test");
const assert = require("node:assert/strict");

const { createDesktopReactMount } = require("../src/ui/mountDesktopReactApp");

function makeShell(overrides = {}) {
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

function makeRouter(initialRoute = "home") {
  let route = initialRoute;
  const callbacks = [];
  return {
    getRoute: () => route,
    navigate: (r) => {
      route = r;
      callbacks.forEach((fn) => fn(r));
    },
    onRouteChange: (fn) => {
      callbacks.push(fn);
      return () => {};
    },
  };
}

function makeSavedArtistsShell(overrides = {}) {
  return {
    getViewProps: () => ({
      savedArtists: [],
      selectedIds: [],
      searchQuery: "",
      searchResults: [],
      isSearching: false,
    }),
    loadSavedArtists: async () => {},
    toggleArtistSelection: () => {},
    setSearchQuery: () => {},
    searchArtists: async () => {},
    addArtist: async () => {},
    ...overrides,
  };
}

test("routed mount calls render with SavedArtistsView when route is saved", async () => {
  const renders = [];
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
    resolveContainer: () => ({}),
  });

  await mount.mount();

  assert.equal(renders.length, 1);
  assert.equal(renders[0].type?.name, "SavedArtistsView");
});

test("routed mount calls render with ChatAppView when route is home", async () => {
  const renders = [];
  const shell = makeShell();
  const router = makeRouter("home");
  const savedShell = makeSavedArtistsShell();

  const fakeRoot = { render: (el) => renders.push(el) };

  const mount = createDesktopReactMount({
    shell,
    router,
    savedArtistsShell: savedShell,
    createRootImpl: () => fakeRoot,
    resolveContainer: () => ({}),
  });

  await mount.mount();

  assert.equal(renders.length, 1);
  assert.equal(renders[0].type?.name, "ChatAppView");
});

test("routed mount calls render with SettingsView when route is settings", async () => {
  const renders = [];
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
    resolveContainer: () => ({}),
  });

  await mount.mount();

  assert.equal(renders.length, 1);
  assert.equal(renders[0].type?.name, "SettingsView");
});
