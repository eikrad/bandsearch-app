import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSavedArtistsShell, type SavedArtistsShellCollaborator } from "../src/createSavedArtistsShell.js";
import { createDesktopReactMount } from "../src/ui/mountDesktopReactApp.js";
import { SavedArtistsView } from "../src/ui/SavedArtistsView.js";
import type { SavedArtistsHandlers, SavedArtistsViewProps } from "../src/ui/viewTypes.js";
import type { StatusMessageOptions } from "../src/statusMessage.js";
import type { ArtistGroup, ArtistSearchResult, SavedBand } from "../src/domain.js";
import { fakeContainer, fakeReactRoot, routedViewOf } from "./helpers/fakeDom.js";
import type { Route } from "../src/createHashRouter.js";

// These tests pair the real shell with the real view. Every other saved-artists
// test feeds the view a hand-written prop object, which is how the shell's
// output drifted out of the shape the view renders without anything going red.
function fakeShellApp(overrides: Partial<SavedArtistsShellCollaborator> = {}): SavedArtistsShellCollaborator {
  let selectedArtistIds: string[] = [];
  return {
    listSavedBands: async () => [],
    listGroups: async (): Promise<ArtistGroup[]> => [],
    getState: () => ({ selectedArtistIds }),
    toggleArtistSelection: (id: string) => {
      selectedArtistIds = selectedArtistIds.includes(id)
        ? selectedArtistIds.filter((x) => x !== id)
        : [...selectedArtistIds, id];
    },
    clearArtistSelection: () => { selectedArtistIds = []; },
    setPendingStyleRef: () => {},
    searchArtists: async (): Promise<ArtistSearchResult[]> => [],
    saveBand: async () => ({}),
    deleteSavedBand: async () => ({}),
    exportPreferences: async () => [],
    importPreferences: async () => ({ imported: 0, skipped: 0, failed: 0 }),
    createGroup: async () => ({}),
    deleteGroup: async () => ({}),
    autoGroup: async () => ({}),
    ...overrides,
  };
}

function renderScreen(shell: ReturnType<typeof createSavedArtistsShell>): string {
  return renderToStaticMarkup(
    React.createElement(SavedArtistsView, {
      viewProps: shell.getViewProps(),
      handlers: {},
    }),
  );
}

const CODEINE: SavedBand = { id: "b1", name: "Codeine", rating: 4, categories: ["slowcore"], note: "" };
const BEDHEAD: SavedBand = { id: "b2", name: "Bedhead", rating: 5, categories: [], note: "" };

test("saved artists screen shows the artists the shell loaded", async () => {
  const shell = createSavedArtistsShell({
    app: fakeShellApp({ listSavedBands: async () => [CODEINE, BEDHEAD] }),
  });

  await shell.loadSavedArtists();

  const html = renderScreen(shell);
  assert.equal(html.includes("Codeine"), true);
  assert.equal(html.includes("Bedhead"), true);
});

test("saved artists screen shows the empty state when nothing is saved", async () => {
  const shell = createSavedArtistsShell({ app: fakeShellApp() });

  await shell.loadSavedArtists();

  assert.equal(renderScreen(shell).includes("No saved artists"), true);
});

test("saved artists screen offers the style-reference bar once an artist is selected", async () => {
  const shell = createSavedArtistsShell({
    app: fakeShellApp({ listSavedBands: async () => [CODEINE] }),
  });
  await shell.loadSavedArtists();
  // "Use as style reference" is also the per-artist tick button's title, so the
  // selection bar is identified by its own count label.
  assert.equal(renderScreen(shell).includes("1 selected"), false);

  shell.toggleArtistSelection("b1");

  assert.equal(renderScreen(shell).includes("1 selected"), true);
});

test("saved artists screen shows the groups the shell loaded", async () => {
  const shell = createSavedArtistsShell({
    app: fakeShellApp({
      listSavedBands: async () => [CODEINE],
      listGroups: async () => [{ id: "g1", name: "Slowcore", memberIds: ["b1"] }],
    }),
  });

  await shell.loadSavedArtists();

  assert.equal(renderScreen(shell).includes("Slowcore"), true);
});

test("activating a style reference hands the selected ids to the chat and clears the selection", async () => {
  const pendingStyleRefs: string[][] = [];
  const shell = createSavedArtistsShell({
    app: fakeShellApp({
      listSavedBands: async () => [CODEINE, BEDHEAD],
      setPendingStyleRef: (ids: string[]) => { pendingStyleRefs.push(ids); },
    }),
  });
  await shell.loadSavedArtists();
  shell.toggleArtistSelection("b1");
  shell.toggleArtistSelection("b2");

  await shell.activateStyleRef();

  assert.deepEqual(pendingStyleRefs, [["b1", "b2"]]);
  assert.equal(shell.getViewProps().selectedCount, 0);
});

test("saved artists screen lists search results the user can add", async () => {
  const shell = createSavedArtistsShell({
    app: fakeShellApp({
      searchArtists: async () => [{ id: "mb-1", name: "Duster", score: 100, disambiguation: "" }],
    }),
  });
  await shell.loadSavedArtists();

  shell.setSearchQuery("duster");
  await shell.searchArtists();

  const html = renderScreen(shell);
  assert.equal(html.includes("Duster"), true);
  assert.equal(html.includes("Add"), true);
});

// --- the screen as the mount assembles it -----------------------------------
//
// The tests above drive the shell directly. These drive the handlers the mount
// actually hands to the view, which is where the previous implementation failed
// silently: the screen was reachable through a route whose handler object had no
// onExport / onImportFile / onCreateGroup / onDeleteGroup / onAutoGroup, and the
// view calls all of those with `?.`, so the buttons did nothing at all.

type RenderedScreen = ReactElement<{ handlers: SavedArtistsHandlers }>;

function mountSavedScreen(app: SavedArtistsShellCollaborator, status?: StatusMessageOptions) {
  const shell = createSavedArtistsShell({ app, status });
  let lastRender: RenderedScreen | null = null;
  let renders = 0;
  const mount = createDesktopReactMount({
    shell: {
      getViewProps: () => ({}),
      updateMode: async () => {},
      submitQuery: async () => {},
    },
    router: {
      getRoute: () => "saved",
      navigate: () => {},
      onRouteChange: () => {},
    },
    savedArtistsShell: shell,
    createRootImpl: () => fakeReactRoot((element) => {
      lastRender = routedViewOf(element) as RenderedScreen;
      renders += 1;
    }),
    resolveContainer: () => fakeContainer(),
  });
  return {
    shell,
    mount,
    renders: () => renders,
    statusMessage(): unknown {
      const rendered: RenderedScreen | null = lastRender;
      assert.ok(rendered, "expected the saved screen to have rendered");
      return (rendered.props as unknown as { viewProps: SavedArtistsViewProps }).viewProps.statusMessage;
    },
    // The handlers React would invoke on click, taken from the rendered element.
    handlers(): SavedArtistsHandlers {
      const rendered: RenderedScreen | null = lastRender;
      assert.ok(rendered, "expected the saved screen to have rendered");
      return rendered.props.handlers;
    },
  };
}

test("landing directly on the saved route loads the artists", async () => {
  // A reload or deep link enters the route without going through the Saved
  // button, so the screen has to fetch for itself rather than relying on the
  // navigation handler to have done it.
  const screen = mountSavedScreen(fakeShellApp({ listSavedBands: async () => [CODEINE] }));

  await screen.mount.mount();

  assert.equal(screen.shell.getViewProps().artists.length, 1);
});

test("arriving via the Saved button loads the artists", async () => {
  let route: Route = "home";
  const listeners: Array<() => void> = [];
  const shell = createSavedArtistsShell({ app: fakeShellApp({ listSavedBands: async () => [CODEINE] }) });
  const mount = createDesktopReactMount({
    shell: { getViewProps: () => ({}), updateMode: async () => {}, submitQuery: async () => {} },
    router: {
      getRoute: () => route,
      navigate: (r: Route) => { route = r; listeners.forEach((fn) => fn()); },
      onRouteChange: (fn: () => void) => { listeners.push(fn); },
    },
    savedArtistsShell: shell,
    createRootImpl: () => fakeReactRoot(),
    resolveContainer: () => fakeContainer(),
  });
  await mount.mount();
  assert.equal(shell.getViewProps().artists.length, 0, "chat route should not have fetched");

  await mount.handlers.onNavigateSaved();

  assert.equal(shell.getViewProps().artists.length, 1);
});

test("the mounted screen sends a new group to the app", async () => {
  const created: string[] = [];
  const screen = mountSavedScreen(fakeShellApp({ createGroup: async (name: string) => { created.push(name); return {}; } }));
  await screen.mount.mount();

  await screen.handlers().onCreateGroup?.("Slowcore");

  assert.deepEqual(created, ["Slowcore"]);
});

test("the mounted screen asks the app to group by genre", async () => {
  let autoGrouped = false;
  const screen = mountSavedScreen(fakeShellApp({ autoGroup: async () => { autoGrouped = true; return {}; } }));
  await screen.mount.mount();

  await screen.handlers().onAutoGroup?.();

  assert.equal(autoGrouped, true);
});

test("the mounted screen deletes a group through the app", async () => {
  const deleted: string[] = [];
  const screen = mountSavedScreen(fakeShellApp({ deleteGroup: async (id: string) => { deleted.push(id); return {}; } }));
  await screen.mount.mount();

  await screen.handlers().onDeleteGroup?.("g1");

  assert.deepEqual(deleted, ["g1"]);
});

test("the mounted screen imports bands through the app", async () => {
  const imported: unknown[][] = [];
  const screen = mountSavedScreen(fakeShellApp({ importPreferences: async (bands: unknown[]) => { imported.push(bands); return { imported: bands.length, skipped: 0, failed: 0 }; } }));
  await screen.mount.mount();

  await screen.handlers().onImportFile?.({ text: async () => JSON.stringify([{ name: "Duster" }]) } as File);

  assert.deepEqual(imported, [[{ name: "Duster" }]]);
});

test("the mounted screen adds a searched artist through the app", async () => {
  const saved: unknown[] = [];
  const screen = mountSavedScreen(fakeShellApp({ saveBand: async (target) => { saved.push(target); return {}; } }));
  await screen.mount.mount();

  await screen.handlers().onAddArtist?.({ id: "mb-1", name: "Duster" });

  assert.deepEqual(saved, [{ name: "Duster", musicbrainzArtistId: "mb-1", suggestedNote: "Added via search." }]);
});

test("the mounted screen deletes a saved artist through the app", async () => {
  const deleted: string[] = [];
  const screen = mountSavedScreen(fakeShellApp({ deleteSavedBand: async (id: string) => { deleted.push(id); return {}; } }));
  await screen.mount.mount();

  await screen.handlers().onDelete?.("b1");

  assert.deepEqual(deleted, ["b1"]);
});

// --- The saved screen says what its actions did (#313) -----------------------

const offline = async (): Promise<never> => { throw new Error("offline"); };

async function savedScreenWith(app: Partial<SavedArtistsShellCollaborator>, status?: StatusMessageOptions) {
  const screen = mountSavedScreen(fakeShellApp({ listSavedBands: async () => [CODEINE], ...app }), status);
  await screen.mount.mount();
  return screen;
}

test("adding an artist from search confirms it", async () => {
  const screen = await savedScreenWith({});

  await screen.handlers().onAddArtist?.({ id: "mb-fen", name: "Fen" });

  assert.deepEqual(screen.statusMessage(), { type: "success", message: "Added Fen." });
});

test("each failing action on the saved screen says so instead of doing nothing", async () => {
  const cases: Array<[string, Partial<SavedArtistsShellCollaborator>, (h: SavedArtistsHandlers) => unknown, string]> = [
    ["add", { saveBand: offline }, (h) => h.onAddArtist?.({ id: "mb-fen", name: "Fen" }), "Could not add Fen."],
    ["remove", { deleteSavedBand: offline }, (h) => h.onDelete?.("b1"), "Could not remove Codeine."],
    ["search", { searchArtists: offline }, (h) => h.onSearch?.("fen"), "Artist search failed."],
    ["export", { exportPreferences: offline }, (h) => h.onExport?.(), "Export failed."],
    ["new group", { createGroup: offline }, (h) => h.onCreateGroup?.("Slowcore"), "Could not create the group Slowcore."],
    ["delete group", { deleteGroup: offline }, (h) => h.onDeleteGroup?.("g1"), "Could not delete the group."],
    ["auto group", { autoGroup: offline }, (h) => h.onAutoGroup?.(), "Could not group by genre."],
  ];
  for (const [name, app, act, message] of cases) {
    const screen = await savedScreenWith(app);

    await act(screen.handlers());

    assert.deepEqual(screen.statusMessage(), { type: "error", message }, name);
  }
});

test("a file that is not an export is refused without calling the API", async () => {
  let imported = false;
  const screen = await savedScreenWith({ importPreferences: async () => { imported = true; return { imported: 0, skipped: 0, failed: 0 }; } });

  await screen.handlers().onImportFile?.(new File(["{\"not\": \"a list\"}"], "x.json"));

  assert.equal(imported, false);
  assert.deepEqual(screen.statusMessage(), { type: "error", message: "That file isn't a Bandsearch export." });
});

test("an import reports how many artists arrived and how many were already saved", async () => {
  const screen = await savedScreenWith({ importPreferences: async () => ({ imported: 2, skipped: 1, failed: 0 }) });

  await screen.handlers().onImportFile?.(new File(["[{}, {}, {}]"], "bands.json"));

  assert.deepEqual(screen.statusMessage(), { type: "success", message: "Imported 2 artists, 1 already saved." });
});

test("an import with artists the API refused is reported as an error", async () => {
  const screen = await savedScreenWith({ importPreferences: async () => ({ imported: 1, skipped: 0, failed: 2 }) });

  await screen.handlers().onImportFile?.(new File(["[{}, {}, {}]"], "bands.json"));

  assert.deepEqual(screen.statusMessage(), { type: "error", message: "Imported 1 artist; 2 could not be imported." });
});

test("a cleared message is repainted on the saved screen", async () => {
  let fire = () => {};
  const screen = await savedScreenWith({}, { setTimeoutImpl: (fn) => { fire = fn; return 1; }, clearTimeoutImpl: () => {} });
  await screen.handlers().onAddArtist?.({ id: "mb-fen", name: "Fen" });
  const rendersBefore = screen.renders();

  fire();
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(screen.renders() > rendersBefore, "the screen was painted again");
  assert.equal(screen.statusMessage(), null);
});

test("the saved screen shows its status line", async () => {
  const shell = createSavedArtistsShell({ app: fakeShellApp({ saveBand: offline }) });

  await shell.addArtist({ id: "mb-fen", name: "Fen" });

  assert.match(renderScreen(shell), /Could not add Fen\./);
});

test("a successful export downloads the saved artists as a file", async () => {
  const downloads: Array<[string, unknown]> = [];
  const shell = createSavedArtistsShell({ app: fakeShellApp({ exportPreferences: async () => [{ name: "Codeine" }] }) });
  let handlers: SavedArtistsHandlers = {};
  const mount = createDesktopReactMount({
    shell: { getViewProps: () => ({}), updateMode: async () => {}, submitQuery: async () => {} },
    router: { getRoute: () => "saved", navigate: () => {}, onRouteChange: () => {} },
    savedArtistsShell: shell,
    downloadJsonImpl: (filename, data) => { downloads.push([filename, data]); },
    createRootImpl: () => fakeReactRoot((element) => { handlers = (routedViewOf(element) as RenderedScreen).props.handlers; }),
    resolveContainer: () => fakeContainer(),
  });
  await mount.mount();

  await handlers.onExport?.();

  assert.deepEqual(downloads, [["bandsearch-artists.json", [{ name: "Codeine" }]]]);
});
