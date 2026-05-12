const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { createPreferenceRepository } = require("../src/preferences/preferenceRepository");

function freshApp(musicBrainzClient) {
  return createApp({
    preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }),
    musicBrainzClient,
  });
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

test("GET /search/artists returns artists from MusicBrainz for a query", async () => {
  const fakeMusicBrainz = {
    searchArtists: async (query) => {
      assert.equal(query, "Alcest");
      return [{ id: "abc-123", name: "Alcest", score: 100, disambiguation: "French shoegaze" }];
    },
  };

  const app = freshApp(fakeMusicBrainz);
  const result = await makeGetRequest(app, "/search/artists?q=Alcest");

  assert.equal(result.status, 200);
  assert.equal(Array.isArray(result.data.artists), true);
  assert.equal(result.data.artists[0].id, "abc-123");
  assert.equal(result.data.artists[0].name, "Alcest");
});

test("GET /search/artists returns 400 when query is empty", async () => {
  const fakeMusicBrainz = { searchArtists: async () => [] };
  const app = freshApp(fakeMusicBrainz);
  const result = await makeGetRequest(app, "/search/artists?q=");

  assert.equal(result.status, 400);
  assert.equal(result.data.error.code, "validation_error");
  assert.equal(result.data.error.message, "search query is required");
});

test("GET /search/artists returns 502 when MusicBrainz fails", async () => {
  const fakeMusicBrainz = {
    searchArtists: async () => {
      throw new Error("timeout");
    },
  };
  const app = freshApp(fakeMusicBrainz);
  const result = await makeGetRequest(app, "/search/artists?q=Alcest");

  assert.equal(result.status, 502);
  assert.equal(result.data.error.code, "search_unavailable");
});
