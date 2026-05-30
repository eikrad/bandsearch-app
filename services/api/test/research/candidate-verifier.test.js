const test = require("node:test");
const assert = require("node:assert/strict");

const { verifyCandidatesWithMusicBrainz, mergeVerifiedCandidates } = require("../../src/agent/research/candidateVerifier");

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

test("mergeVerifiedCandidates deduplicates by mbid", () => {
  const a = { name: "Capra", mbid: "mbid-1", verified: true, evidenceUrls: ["https://a.example"], evidenceSnippets: ["s1"], sourceQueries: ["q1"] };
  const b = { name: "capra", mbid: "mbid-1", verified: true, evidenceUrls: ["https://b.example"], evidenceSnippets: ["s2"], sourceQueries: ["q2"] };
  const result = mergeVerifiedCandidates([a, b]);
  assert.equal(result.length, 1);
  assert.equal(result[0].mbid, "mbid-1");
  assert.equal(result[0].evidenceUrls.length, 2);
});

test("mergeVerifiedCandidates deduplicates by name lowercase when no mbid", () => {
  const a = { name: "Vein.fm", verified: false, evidenceUrls: ["https://x.example"], evidenceSnippets: ["x"], sourceQueries: ["q1"] };
  const b = { name: "vein.fm", verified: false, evidenceUrls: ["https://y.example"], evidenceSnippets: ["y"], sourceQueries: ["q2"] };
  const result = mergeVerifiedCandidates([a, b]);
  assert.equal(result.length, 1);
});

test("mergeVerifiedCandidates prefers verified:true entry on collision (same mbid)", () => {
  // Same mbid: once with a failed lookup (verified:false), once with a successful one (verified:true)
  const fromRound1 = { name: "Portrayal of Guilt", mbid: "mbid-pog", verified: false, evidenceUrls: ["https://a.example"], evidenceSnippets: ["a"], sourceQueries: ["q1"] };
  const fromRound2 = { name: "Portrayal of Guilt", canonicalName: "Portrayal of Guilt", mbid: "mbid-pog", verified: true, evidenceUrls: ["https://b.example"], evidenceSnippets: ["b"], sourceQueries: ["q2"], mbTags: ["screamo"], mbGenres: [] };
  const result = mergeVerifiedCandidates([fromRound1, fromRound2]);
  assert.equal(result.length, 1);
  assert.equal(result[0].verified, true);
  assert.equal(result[0].mbid, "mbid-pog");
});

test("mergeVerifiedCandidates preserves all distinct artists", () => {
  const input = [
    { name: "Band A", mbid: "mbid-a", verified: true, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [] },
    { name: "Band B", mbid: "mbid-b", verified: true, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [] },
    { name: "Band C", mbid: "mbid-c", verified: false, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [] },
  ];
  const result = mergeVerifiedCandidates(input);
  assert.equal(result.length, 3);
});
