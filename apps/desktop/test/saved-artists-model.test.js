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
