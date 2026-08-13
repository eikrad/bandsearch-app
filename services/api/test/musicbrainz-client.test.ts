import { test } from "node:test";
import assert from "node:assert/strict";

import { createMusicBrainzClient } from "../src/integrations/musicbrainz.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("MusicBrainz client maps artist search results", async () => {
  const fakeFetch = async () =>
    jsonResponse({
      artists: [
        { id: "a1", name: "Alcest", score: 98, disambiguation: "FR" },
        { id: "a2", name: "Agalloch", score: 95 },
      ],
    });

  const client = createMusicBrainzClient({ fetchImpl: fakeFetch });
  const artists = await client.searchArtists("alcest");

  assert.deepEqual(artists, [
    { id: "a1", name: "Alcest", score: 98, disambiguation: "FR" },
    { id: "a2", name: "Agalloch", score: 95, disambiguation: "" },
  ]);
});

test("MusicBrainz client throws on non-OK responses", async () => {
  const fakeFetch = async () => new Response(null, { status: 503 });

  const client = createMusicBrainzClient({ fetchImpl: fakeFetch });

  await assert.rejects(
    () => client.searchArtists("alcest"),
    /musicbrainz request failed with status 503/,
  );
});

test("lookupArtist maps tags genres urls and life-span", async () => {
  let requestedUrl = "";
  const fakeFetch = async (url: string | URL | Request) => {
    requestedUrl = String(url);
    return jsonResponse({
        id: "mbid-1",
        name: "Grade",
        tags: [{ name: "hardcore", count: 2 }],
        genres: [{ name: "melodic hardcore", count: 1 }],
        "life-span": { begin: "1994", end: null, ended: false },
        relations: [
          {
            type: "bandcamp",
            url: { resource: "https://grade.bandcamp.com" },
          },
        ],
      });
  };

  const client = createMusicBrainzClient({ fetchImpl: fakeFetch, retries: 0 });
  const details = await client.lookupArtist("mbid-1");

  assert.match(requestedUrl, /\/artist\/mbid-1\?/);
  assert.match(requestedUrl, /inc=tags\+genres\+url-rels/);
  assert.equal(details.name, "Grade");
  assert.deepEqual(details.tags, ["hardcore"]);
  assert.deepEqual(details.genres, ["melodic hardcore"]);
  assert.equal(details.lifeSpan.begin, "1994");
  assert.equal(details.lifeSpan.ended, false);
  assert.ok(details.urls.some((u) => u.url.includes("bandcamp")));
});

test("lookupArtist rejects empty mbid", async () => {
  const client = createMusicBrainzClient({
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(() => client.lookupArtist(""), /mbid is required/);
});
