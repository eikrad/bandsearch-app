const test = require("node:test");
const assert = require("node:assert/strict");

const { createSavedArtistsModel } = require("../src/savedArtistsModel");

function makeApp(savedBands = []) {
  const bands = [...savedBands];
  return {
    listSavedBands: async () => bands,
    deleteSavedBand: async (id) => { const i = bands.findIndex((b) => b.id === id); if (i >= 0) bands.splice(i, 1); },
  };
}

test("saved artists model returns empty artist list initially", () => {
  const model = createSavedArtistsModel({ app: makeApp() });
  const state = model.getScreenState();
  assert.deepEqual(state.artists, []);
  assert.equal(state.isLoading, false);
});

test("saved artists model maps saved bands to UI items after load", async () => {
  const bands = [
    { id: "b1", name: "Fen", rating: 4, categories: ["post-black"], note: "Atmospheric" },
    { id: "b2", name: "Alcest", rating: 5, categories: [], note: "" },
  ];
  const model = createSavedArtistsModel({ app: makeApp(bands) });
  await model.loadSavedArtists();
  const state = model.getScreenState();

  assert.equal(state.artists.length, 2);
  assert.equal(state.artists[0].id, "b1");
  assert.equal(state.artists[0].name, "Fen");
  assert.equal(state.artists[0].rating, 4);
  assert.deepEqual(state.artists[0].categoryTags, ["post-black"]);
  assert.equal(state.artists[0].note, "Atmospheric");
  assert.equal(state.artists[0].isSelected, false);
});

test("saved artists model sets isLoading true during load", async () => {
  let observedDuringLoad = null;
  const app = {
    listSavedBands: async () => {
      observedDuringLoad = model.getScreenState().isLoading;
      return [];
    },
  };
  const model = createSavedArtistsModel({ app });
  await model.loadSavedArtists();

  assert.equal(observedDuringLoad, true);
  assert.equal(model.getScreenState().isLoading, false);
});

test("saved artists model includes header in screen state", () => {
  const model = createSavedArtistsModel({ app: makeApp() });
  const state = model.getScreenState();
  assert.equal(state.header.title, "Saved Artists");
  assert.ok(state.header.subtitle);
});

test("saved artists model tracks search results after searchArtists call", async () => {
  const model = createSavedArtistsModel({
    app: {
      ...makeApp(),
      searchArtists: async () => [{ id: "abc", name: "Alcest", score: 100, disambiguation: "French blackgaze" }],
    },
  });

  await model.searchArtists("Alcest");
  const state = model.getScreenState();

  assert.equal(state.searchResults.length, 1);
  assert.equal(state.searchResults[0].name, "Alcest");
  assert.equal(state.searchResults[0].id, "abc");
});

test("saved artists model isSearching is true during search", async () => {
  let resolveSearch;
  const model = createSavedArtistsModel({
    app: {
      ...makeApp(),
      searchArtists: () => new Promise((resolve) => { resolveSearch = resolve; }),
    },
  });

  const searchPromise = model.searchArtists("Fen");
  assert.equal(model.getScreenState().isSearching, true);
  resolveSearch([]);
  await searchPromise;
  assert.equal(model.getScreenState().isSearching, false);
});

test("saved artists model toggleSelection adds artist to selection", async () => {
  const bands = [{ id: "b1", name: "Fen", rating: 4, categories: [], note: "" }];
  const model = createSavedArtistsModel({ app: makeApp(bands) });
  await model.loadSavedArtists();

  model.toggleSelection("b1");

  const state = model.getScreenState();
  assert.equal(state.artists[0].isSelected, true);
  assert.equal(state.selectedCount, 1);
});

test("saved artists model toggleSelection removes already-selected artist", async () => {
  const bands = [{ id: "b1", name: "Fen", rating: 4, categories: [], note: "" }];
  const model = createSavedArtistsModel({ app: makeApp(bands) });
  await model.loadSavedArtists();

  model.toggleSelection("b1");
  model.toggleSelection("b1");

  const state = model.getScreenState();
  assert.equal(state.artists[0].isSelected, false);
  assert.equal(state.selectedCount, 0);
});

test("saved artists model getSelectedIds returns current selection as array", async () => {
  const bands = [
    { id: "b1", name: "Fen", rating: 4, categories: [], note: "" },
    { id: "b2", name: "Alcest", rating: 5, categories: [], note: "" },
  ];
  const model = createSavedArtistsModel({ app: makeApp(bands) });
  await model.loadSavedArtists();

  model.toggleSelection("b1");
  model.toggleSelection("b2");
  const ids = model.getSelectedIds();

  assert.equal(ids.length, 2);
  assert.equal(ids.includes("b1"), true);
  assert.equal(ids.includes("b2"), true);
});

test("saved artists model deleteSavedArtist removes band from list", async () => {
  const bands = [
    { id: "b1", name: "Fen", rating: 4, categories: [], note: "" },
    { id: "b2", name: "Alcest", rating: 5, categories: [], note: "" },
  ];
  const model = createSavedArtistsModel({ app: makeApp(bands) });
  await model.loadSavedArtists();

  await model.deleteSavedArtist("b1");

  const state = model.getScreenState();
  assert.equal(state.artists.length, 1);
  assert.equal(state.artists[0].id, "b2");
});

test("saved artists model deleteSavedArtist also removes from selection", async () => {
  const bands = [{ id: "b1", name: "Fen", rating: 4, categories: [], note: "" }];
  const model = createSavedArtistsModel({ app: makeApp(bands) });
  await model.loadSavedArtists();
  model.toggleSelection("b1");
  assert.equal(model.getScreenState().selectedCount, 1);

  await model.deleteSavedArtist("b1");

  assert.equal(model.getScreenState().selectedCount, 0);
});

test("saved artists model clearSelection empties the selection", async () => {
  const bands = [
    { id: "b1", name: "Fen", rating: 4, categories: [], note: "" },
    { id: "b2", name: "Alcest", rating: 5, categories: [], note: "" },
  ];
  const model = createSavedArtistsModel({ app: makeApp(bands) });
  await model.loadSavedArtists();
  model.toggleSelection("b1");
  model.toggleSelection("b2");
  assert.equal(model.getScreenState().selectedCount, 2);

  model.clearSelection();

  assert.equal(model.getScreenState().selectedCount, 0);
  assert.equal(model.getSelectedIds().length, 0);
});

test("saved artists model clears search results for empty query", async () => {
  const model = createSavedArtistsModel({
    app: {
      ...makeApp(),
      searchArtists: async () => [{ id: "x", name: "Test", score: 80, disambiguation: "" }],
    },
  });

  await model.searchArtists("Test");
  assert.equal(model.getScreenState().searchResults.length, 1);
  await model.searchArtists("");
  assert.equal(model.getScreenState().searchResults.length, 0);
});

test("saved artists model exportArtists returns raw saved bands from app", async () => {
  const bands = [{ id: "b1", name: "Fen", rating: 4, categories: ["post-metal"], note: "" }];
  const model = createSavedArtistsModel({ app: makeApp(bands) });
  await model.loadSavedArtists();

  const exported = await model.exportArtists();

  assert.equal(Array.isArray(exported), true);
  assert.equal(exported.length, 1);
  assert.equal(exported[0].name, "Fen");
});

test("saved artists model loadGroups stores groups in screen state", async () => {
  const model = createSavedArtistsModel({
    app: {
      ...makeApp(),
      listGroups: async () => [{ id: "g1", name: "Blackgaze", memberIds: [] }],
    },
  });

  await model.loadGroups();

  const state = model.getScreenState();
  assert.equal(Array.isArray(state.groups), true);
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].name, "Blackgaze");
});

test("saved artists model createGroup calls app and reloads groups", async () => {
  const created = [];
  const model = createSavedArtistsModel({
    app: {
      ...makeApp(),
      listGroups: async () => created.map((n, i) => ({ id: `g${i}`, name: n, memberIds: [] })),
      createGroup: async (name) => { created.push(name); return { ok: true, group: { id: "g0", name, memberIds: [] } }; },
    },
  });

  await model.createGroup("Post-metal");

  const state = model.getScreenState();
  assert.equal(state.groups.length, 1);
  assert.equal(state.groups[0].name, "Post-metal");
});

test("saved artists model autoGroupByGenre calls app and reloads groups", async () => {
  let autoCalled = false;
  const model = createSavedArtistsModel({
    app: {
      ...makeApp(),
      listGroups: async () => autoCalled ? [{ id: "g1", name: "blackgaze", memberIds: [] }] : [],
      autoGroupByGenre: async () => { autoCalled = true; return { groups: [] }; },
    },
  });

  await model.autoGroupByGenre();

  assert.equal(autoCalled, true);
  const state = model.getScreenState();
  assert.equal(Array.isArray(state.groups), true);
});

test("saved artists model importArtists calls app importArtists and reloads", async () => {
  let importCalled = false;
  let importedBands = null;
  const store = [];
  const app = {
    listSavedBands: async () => [...store],
    deleteSavedBand: async (id) => { const i = store.findIndex((b) => b.id === id); if (i >= 0) store.splice(i, 1); },
    importArtists: async (toImport) => {
      importCalled = true;
      importedBands = toImport;
      store.push(...toImport.map((b, i) => ({ ...b, id: `imported-${i}` })));
      return { imported: toImport.length, skipped: 0 };
    },
  };

  const model = createSavedArtistsModel({ app });
  const payload = [{ musicbrainzArtistId: "x1", name: "Alcest", rating: 5, categories: [], note: "" }];
  const result = await model.importArtists(payload);

  assert.equal(importCalled, true);
  assert.deepEqual(importedBands, payload);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 0);
  assert.equal(model.getScreenState().artists.length, 1);
});
