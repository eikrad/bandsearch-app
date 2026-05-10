const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

function createMusicBrainzStub(results) {
  return {
    searchArtists: async (query) => {
      return results.map((r) => ({ ...r, queryUsed: query }));
    },
  };
}

async function makeGetRequest(app, path) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

test("GET /artists/search returns artists from MusicBrainz", async () => {
  const app = createApp({
    musicBrainzClient: createMusicBrainzStub([
      { id: "mb-1", name: "Fen", score: 100, disambiguation: "UK black metal" },
      { id: "mb-2", name: "Fen (UK)", score: 80, disambiguation: "" },
    ]),
  });

  const result = await makeGetRequest(app, "/artists/search?query=fen");

  assert.equal(result.status, 200);
  assert.equal(Array.isArray(result.data.artists), true);
  assert.equal(result.data.artists.length, 2);
  assert.equal(result.data.artists[0].id, "mb-1");
  assert.equal(result.data.artists[0].name, "Fen");
  assert.equal(result.data.artists[0].score, 100);
  assert.equal(result.data.artists[0].disambiguation, "UK black metal");
});

test("GET /artists/search requires non-empty query parameter", async () => {
  const app = createApp({
    musicBrainzClient: createMusicBrainzStub([]),
  });

  const noQuery = await makeGetRequest(app, "/artists/search");
  assert.equal(noQuery.status, 400);
  assert.equal(noQuery.data.error.code, "validation_error");

  const emptyQuery = await makeGetRequest(app, "/artists/search?query=");
  assert.equal(emptyQuery.status, 400);
  assert.equal(emptyQuery.data.error.code, "validation_error");
});

test("GET /artists/search passes query to MusicBrainz client", async () => {
  const queries = [];
  const app = createApp({
    musicBrainzClient: {
      searchArtists: async (q) => {
        queries.push(q);
        return [];
      },
    },
  });

  await makeGetRequest(app, "/artists/search?query=alcest");
  assert.equal(queries.length, 1);
  assert.equal(queries[0], "alcest");
});
