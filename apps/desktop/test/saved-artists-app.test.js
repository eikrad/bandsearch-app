const test = require("node:test");
const assert = require("node:assert/strict");

const { bootstrapDesktopApp } = require("../src/index");
const { jsonResponse } = require("./helpers/fakeResponse");

function createStubFetch({ savedBands = [], artists = [], recommendations = [] } = {}) {
  return async (url, init) => {
    if (url.includes("/preferences") && (!init || init.method === "GET")) {
      return jsonResponse({ savedBands });
    }
    if (url.includes("/artists/search")) {
      return jsonResponse({ artists });
    }
    if (url.includes("/recommendations")) {
      return jsonResponse({
          recommendations,
          meta: { modeUsed: "fresh", usedPreferenceContext: false },
        });
    }
    return jsonResponse({});
  };
}

test("app.listSavedBands fetches and returns saved bands", async () => {
  const app = bootstrapDesktopApp({
    fetchImpl: createStubFetch({
      savedBands: [{ id: "pref-1", name: "Fen", rating: 4 }],
    }),
  });

  const bands = await app.listSavedBands();
  assert.equal(bands.length, 1);
  assert.equal(/** @type {{ name: string }} */ (bands[0]).name, "Fen");
});

test("app.searchArtists returns MusicBrainz artist results", async () => {
  const app = bootstrapDesktopApp({
    fetchImpl: createStubFetch({
      artists: [{ id: "mb-1", name: "Fen", score: 100, disambiguation: "" }],
    }),
  });

  const artists = await app.searchArtists("fen");
  assert.equal(artists.length, 1);
  assert.equal(artists[0].name, "Fen");
});

test("app.toggleArtistSelection adds artist id to selectedArtistIds", () => {
  const app = bootstrapDesktopApp({ fetchImpl: createStubFetch() });
  assert.deepEqual(app.getState().selectedArtistIds, []);

  app.toggleArtistSelection("pref-1");
  assert.deepEqual(app.getState().selectedArtistIds, ["pref-1"]);
});

test("app.toggleArtistSelection removes already-selected artist id", () => {
  const app = bootstrapDesktopApp({ fetchImpl: createStubFetch() });

  app.toggleArtistSelection("pref-1");
  app.toggleArtistSelection("pref-1");
  assert.deepEqual(app.getState().selectedArtistIds, []);
});

test("app.requestRecommendations sends priorityContext when artists are selected", async () => {
  const requestBodies = [];
  const fetchImpl = async (url, init) => {
    if (url.includes("/recommendations")) {
      requestBodies.push(JSON.parse(init.body));
      return jsonResponse({ recommendations: [], meta: { modeUsed: "fresh", usedPreferenceContext: false } });
    }
    return jsonResponse({});
  };

  const app = bootstrapDesktopApp({ fetchImpl });

  // Manually inject saved bands and select one
  app.getState().savedBands.push({ id: "pref-1", name: "Alcest", rating: 5 });
  app.toggleArtistSelection("pref-1");

  await app.requestRecommendations("I like atmospheric black metal", "fresh");

  assert.equal(requestBodies.length, 1);
  assert.equal(typeof requestBodies[0].priorityContext, "string");
  assert.equal(requestBodies[0].priorityContext.includes("Alcest"), true);
});
