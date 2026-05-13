const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyCandidatesWithMusicBrainz } = require("../../src/agent/research/candidateVerifier");

test("verifyCandidatesWithMusicBrainz attaches mbid and tags on lookup success", async () => {
  const mb = {
    async searchArtists(q) {
      assert.equal(q, "Capra");
      return [{ id: "mbid-capra", name: "Capra", score: 95 }];
    },
    async lookupArtist(id) {
      assert.equal(id, "mbid-capra");
      return {
        id,
        name: "Capra",
        tags: ["hardcore"],
        genres: ["metalcore"],
        urls: [{ type: "bandcamp", url: "https://capra.bandcamp.com" }],
        lifeSpan: { begin: "2018", ended: false },
      };
    },
  };

  const out = await verifyCandidatesWithMusicBrainz(
    mb,
    [
      {
        name: "Capra",
        evidenceUrls: ["https://blog.example"],
        evidenceSnippets: ["great"],
        sourceQueries: ["q"],
      },
    ],
    ["Grade"],
  );

  assert.equal(out.length, 1);
  assert.equal(out[0].verified, true);
  assert.equal(out[0].mbid, "mbid-capra");
  assert.deepEqual(out[0].mbTags, ["hardcore"]);
  assert.ok(out[0].mbUrls.some((u) => u.includes("bandcamp")));
});

test("verifyCandidatesWithMusicBrainz marks unresolvable as verified false", async () => {
  const mb = {
    async searchArtists() {
      return [];
    },
    async lookupArtist() {
      throw new Error("should not call");
    },
  };

  const out = await verifyCandidatesWithMusicBrainz(
    mb,
    [
      {
        name: "Unknown Act",
        evidenceUrls: ["https://x"],
        evidenceSnippets: ["y"],
        sourceQueries: ["z"],
      },
    ],
    [],
  );

  assert.equal(out[0].verified, false);
  assert.equal(out[0].mbid, undefined);
});
