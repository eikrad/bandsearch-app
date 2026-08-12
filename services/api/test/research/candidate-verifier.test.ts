import test from "node:test";
import assert from "node:assert/strict";
import { verifyCandidatesWithMusicBrainz, mergeVerifiedCandidates, filterCandidatesByObscurity } from "../../src/agent/research/candidateVerifier.js";

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

// ─── filterCandidatesByObscurity ──────────────────────────────────────────────

function makeCandidate(name, listenerCount) {
  return { name, listenerCount, verified: true, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [] };
}

test("filterCandidatesByObscurity returns all candidates when no obscurityTarget", () => {
  const candidates = [makeCandidate("Band A", 1_000_000), makeCandidate("Band B", 100)];
  assert.equal(filterCandidatesByObscurity(candidates).length, 2);
  assert.equal(filterCandidatesByObscurity(candidates, undefined).length, 2);
});

test("filterCandidatesByObscurity filters above threshold for underground (50k)", () => {
  const candidates = [
    makeCandidate("Huge Band", 1_000_000),
    makeCandidate("Mid Band", 30_000),
    makeCandidate("Tiny Band", 500),
  ];
  const result = filterCandidatesByObscurity(candidates, "underground");
  assert.equal(result.length, 2);
  assert.ok(result.every(c => c.listenerCount == null || c.listenerCount <= 50_000));
});

test("filterCandidatesByObscurity keeps null listenerCount (no data = likely obscure)", () => {
  const candidates = [makeCandidate("No Data Band", null), makeCandidate("Huge Band", 2_000_000)];
  const result = filterCandidatesByObscurity(candidates, "obscure");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "No Data Band");
});

test("filterCandidatesByObscurity falls back to all candidates when too few pass the filter", () => {
  const candidates = [
    makeCandidate("Band A", 500_000),
    makeCandidate("Band B", 600_000),
    makeCandidate("Band C", 700_000),
  ];
  // All above underground threshold (50k) — should fall back rather than return 0
  const result = filterCandidatesByObscurity(candidates, "underground");
  assert.equal(result.length, 3, "should fall back to all candidates rather than returning empty");
});

test("filterCandidatesByObscurity cult threshold is 500k", () => {
  const candidates = [
    makeCandidate("Pop Star", 2_000_000),
    makeCandidate("Scene Band", 200_000),
    makeCandidate("Niche Band", 10_000),
  ];
  const result = filterCandidatesByObscurity(candidates, "cult");
  assert.equal(result.length, 2);
  assert.ok(result.every(c => c.listenerCount == null || c.listenerCount <= 500_000));
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
