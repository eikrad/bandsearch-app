import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSavedArtistsShell, type SavedArtistsShellCollaborator } from "../src/createSavedArtistsShell.js";
import { SavedArtistsView } from "../src/ui/SavedArtistsView.js";
import type { ArtistGroup, ArtistSearchResult, SavedBand } from "../src/domain.js";

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
    searchArtists: async (): Promise<ArtistSearchResult[]> => [],
    saveBand: async () => ({}),
    deleteSavedBand: async () => ({}),
    exportPreferences: async () => [],
    importPreferences: async () => ({}),
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
