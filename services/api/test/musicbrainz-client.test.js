const test = require("node:test");
const assert = require("node:assert/strict");

const { createMusicBrainzClient } = require("../src/integrations/musicbrainz");

test("MusicBrainz client maps artist search results", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      artists: [
        { id: "a1", name: "Alcest", score: 98, disambiguation: "FR" },
        { id: "a2", name: "Agalloch", score: 95 },
      ],
    }),
  });

  const client = createMusicBrainzClient({ fetchImpl: fakeFetch });
  const artists = await client.searchArtists("alcest");

  assert.deepEqual(artists, [
    { id: "a1", name: "Alcest", score: 98, disambiguation: "FR" },
    { id: "a2", name: "Agalloch", score: 95, disambiguation: "" },
  ]);
});

test("MusicBrainz client throws on non-OK responses", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 503,
  });

  const client = createMusicBrainzClient({ fetchImpl: fakeFetch });

  await assert.rejects(
    () => client.searchArtists("alcest"),
    /musicbrainz request failed with status 503/,
  );
});
