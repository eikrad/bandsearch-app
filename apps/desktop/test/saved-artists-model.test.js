const test = require("node:test");
const assert = require("node:assert/strict");

const { createSavedArtistsModel } = require("../src/savedArtistsModel");

function makeApp(savedBands = []) {
  return {
    listSavedBands: async () => savedBands,
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
