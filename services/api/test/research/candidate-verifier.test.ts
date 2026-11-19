import test from "node:test";
import assert from "node:assert/strict";
import { verifyCandidatesWithMusicBrainz, mergeVerifiedCandidates, filterCandidatesByObscurity } from "../../src/agent/research/candidateVerifier.js";
import type { MusicBrainzVerifyClient, VerifiedCandidate } from "../../src/agent/research/candidateVerifier.js";

test("verifyCandidatesWithMusicBrainz attaches mbid and tags on lookup success", async () => {
  const mb: MusicBrainzVerifyClient = {
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
  assert.ok(out[0].mbUrls?.some((u) => u.includes("bandcamp")));
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

// ─── filterCandidatesByObscurity (#325: floor and ceiling) ───────────────────

function makeCandidate(name: string, listenerCount: number | null): VerifiedCandidate {
  return { name, listenerCount, verified: true, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [] };
}

const names = (cs: VerifiedCandidate[]) => cs.map((c) => c.name);

test("without an obscurity target every candidate reaches the ranker", () => {
  const candidates = [makeCandidate("Huge", 1_000_000), makeCandidate("Tiny", 100)];
  assert.deepEqual(names(filterCandidatesByObscurity(candidates)), ["Huge", "Tiny"]);
});

test("with enough candidates in range, only those reach the ranker: too obscure is dropped like too mainstream", () => {
  const candidates = [
    makeCandidate("Too obscure", 900),
    makeCandidate("Cult A", 30_000),
    makeCandidate("Cult B", 120_000),
    makeCandidate("Too mainstream", 2_000_000),
    makeCandidate("Cult C", 20_000),
    makeCandidate("Cult D", 500_000),
    makeCandidate("Cult E", 75_000),
  ];
  assert.deepEqual(
    names(filterCandidatesByObscurity(candidates, "cult")),
    ["Cult A", "Cult B", "Cult C", "Cult D", "Cult E"],
  );
});

test("with too few in range, the nearest misses fill up the ranker's pool, in-range first", () => {
  const candidates = [
    makeCandidate("Far too obscure", 300),
    makeCandidate("Just too obscure", 15_000),
    makeCandidate("In range", 40_000),
    makeCandidate("No count", null),
    makeCandidate("Bit too mainstream", 900_000),
    makeCandidate("Too obscure", 6_000),
  ];
  assert.deepEqual(
    names(filterCandidatesByObscurity(candidates, "cult")),
    ["In range", "Just too obscure", "Bit too mainstream", "Too obscure", "Far too obscure"],
  );
});

test("a candidate without a listener count counts as obscure", () => {
  const candidates = [
    makeCandidate("No count", null),
    makeCandidate("Huge", 2_000_000),
    makeCandidate("Tiny", 400),
  ];
  assert.deepEqual(names(filterCandidatesByObscurity(candidates, "obscure")), ["No count", "Tiny", "Huge"]);
  assert.deepEqual(names(filterCandidatesByObscurity(candidates, "underground")), ["Tiny", "Huge", "No count"]);
});

test("several candidates without a count sort last, in their original order", () => {
  const candidates = [makeCandidate("No count 1", null), makeCandidate("No count 2", null), makeCandidate("Cult", 30_000)];
  assert.deepEqual(names(filterCandidatesByObscurity(candidates, "cult")), ["Cult", "No count 1", "No count 2"]);
});

test("with no listener counts at all (Last.fm off) the candidates pass unchanged", () => {
  const candidates = [makeCandidate("A", null), makeCandidate("B", null)];
  assert.deepEqual(names(filterCandidatesByObscurity(candidates, "cult")), ["A", "B"]);
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
