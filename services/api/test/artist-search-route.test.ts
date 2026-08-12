import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";

type ApiData = {
  artists: ArtistResult[];
  error: { code: string; message: string };
};

function parseApiData(value: unknown): ApiData {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as ApiData;
}

type ArtistResult = { id: string; name: string; score: number; disambiguation: string };

function createMusicBrainzStub(results: ArtistResult[]) {
  return {
    searchArtists: async (query: string) => {
      return results.map((r: ArtistResult) => ({ ...r, queryUsed: query }));
    },
  };
}

async function makeGetRequest(app: ReturnType<typeof createApp>, path: string) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const data = parseApiData(await response.json());
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
  assert.equal(noQuery.data.error.message, "search query is required");

  const emptyQuery = await makeGetRequest(app, "/artists/search?query=");
  assert.equal(emptyQuery.status, 400);
  assert.equal(emptyQuery.data.error.code, "validation_error");
});

test("GET /search/artists is removed (404)", async () => {
  const app = createApp({ musicBrainzClient: createMusicBrainzStub([]) });
  const result = await makeGetRequest(app, "/search/artists?q=fen");
  assert.equal(result.status, 404);
});

test("GET /artists/search passes query to MusicBrainz client", async () => {
  const queries: string[] = [];
  const app = createApp({
    musicBrainzClient: {
      searchArtists: async (q: string) => {
        queries.push(q);
        return [];
      },
    },
  });

  await makeGetRequest(app, "/artists/search?query=alcest");
  assert.equal(queries.length, 1);
  assert.equal(queries[0], "alcest");
});
