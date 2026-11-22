import test from "node:test";
import assert from "node:assert/strict";
import { verifyCandidatesWithMusicBrainz, mergeVerifiedCandidates, filterCandidatesByObscurity } from "../../src/agent/research/candidateVerifier.js";
import type { MusicBrainzVerifyClient, VerifiedCandidate } from "../../src/agent/research/candidateVerifier.js";
import { createResearchCache } from "../../src/agent/research/researchCache.js";
import type { ExtractedCandidate } from "../../src/agent/research/candidateExtractor.js";
import type { MusicBrainzArtistRecord } from "../../src/integrations/musicbrainz.js";

function extracted(name: string): ExtractedCandidate {
  return { name, evidenceUrls: ["https://blog.example"], evidenceSnippets: ["great"], sourceQueries: ["q"] };
}

function record(overrides: Partial<MusicBrainzArtistRecord> & { name: string }): MusicBrainzArtistRecord {
  return { id: `mbid-${overrides.name.toLowerCase()}`, score: 100, aliases: [], tags: [], lifeSpan: { ended: false }, ...overrides };
}

/** Answers each batch with the next list of records and remembers what was asked. */
function fakeMusicBrainz(...answers: Array<MusicBrainzArtistRecord[] | Error>) {
  const asked: Array<{ names: string[]; includeAliases: boolean }> = [];
  const mb: MusicBrainzVerifyClient = {
    async findArtistsByName(names, options = {}) {
      asked.push({ names, includeAliases: options.includeAliases === true });
      const answer = answers[asked.length - 1] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { mb, asked };
}

test("every candidate is verified with one MusicBrainz request", async () => {
  const { mb, asked } = fakeMusicBrainz([
    record({ name: "Capra", tags: ["hardcore"], lifeSpan: { begin: "2018", ended: false } }),
    record({ name: "Fen" }),
  ]);

  const out = await verifyCandidatesWithMusicBrainz(mb, [extracted("Capra"), extracted("Fen")], ["Grade"]);

  assert.deepEqual(asked, [{ names: ["Capra", "Fen"], includeAliases: false }]);
  assert.deepEqual(out.map((c) => [c.name, c.verified, c.mbid]), [["Capra", true, "mbid-capra"], ["Fen", true, "mbid-fen"]]);
  assert.deepEqual(out[0]!.mbTags, ["hardcore"]);
  assert.equal(out[0]!.lifeSpan?.begin, "2018");
  assert.equal(out[0]!.canonicalName, "Capra");
});

test("anchor artists are never looked up or returned", async () => {
  const { mb, asked } = fakeMusicBrainz([record({ name: "Fen" })]);
  const out = await verifyCandidatesWithMusicBrainz(mb, [extracted("ALCEST"), extracted("Fen")], ["Alcest"]);
  assert.deepEqual(asked[0]!.names, ["Fen"]);
  assert.deepEqual(out.map((c) => c.name), ["Fen"]);
});

test("a candidate MusicBrainz does not know stays unverified", async () => {
  const { mb } = fakeMusicBrainz([]);
  const out = await verifyCandidatesWithMusicBrainz(mb, [extracted("Unknown Act")], []);
  assert.equal(out[0]!.verified, false);
  assert.equal(out[0]!.mbid, undefined);
});

test("an artist whose name only resembles the candidate does not verify it", async () => {
  // MusicBrainz's search always returns its nearest names: "Watching the Rain"
  // used to be verified as Oasis, "Zero" as Renato Zero.
  const { mb } = fakeMusicBrainz([record({ name: "Renato Zero" })]);
  const out = await verifyCandidatesWithMusicBrainz(mb, [extracted("Zero")], []);
  assert.equal(out[0]!.verified, false);
});

test("spelling variants of the same name match: case, accents, punctuation, a leading article", async () => {
  const { mb } = fakeMusicBrainz([
    record({ name: "Lantlôs" }), record({ name: "Sunn O)))" }), record({ name: "The Moving Sidewalks" }),
  ]);
  const out = await verifyCandidatesWithMusicBrainz(
    mb, [extracted("LANTLOS"), extracted("sunn o"), extracted("Moving Sidewalks")], [],
  );
  assert.deepEqual(out.map((c) => c.canonicalName), ["Lantlôs", "Sunn O)))", "The Moving Sidewalks"]);
});

test("the exact spelling wins over a variant, and among equals the best search score", async () => {
  const { mb } = fakeMusicBrainz([
    record({ id: "pl", name: "MOL.", score: 100 }),
    record({ id: "low", name: "Mol", score: 70 }),
    record({ id: "high", name: "Mol", score: 90 }),
  ]);
  const out = await verifyCandidatesWithMusicBrainz(mb, [extracted("Mol")], []);
  assert.equal(out[0]!.mbid, "high");
});

test("names the first batch missed are searched once more, aliases included", async () => {
  const { mb, asked } = fakeMusicBrainz(
    [record({ name: "Fen" })],
    [record({ id: "haino", name: "灰野敬二", aliases: ["Keiji Haino"] })],
  );
  const out = await verifyCandidatesWithMusicBrainz(mb, [extracted("Fen"), extracted("Keiji Haino")], []);
  assert.deepEqual(asked[1], { names: ["Keiji Haino"], includeAliases: true });
  assert.equal(out[1]!.verified, true);
  assert.equal(out[1]!.canonicalName, "灰野敬二");
});

test("a failed second batch keeps what the first one verified", async () => {
  const { mb } = fakeMusicBrainz([record({ name: "Fen" })], new Error("musicbrainz request failed with status 503"));
  const out = await verifyCandidatesWithMusicBrainz(mb, [extracted("Fen"), extracted("Other")], []);
  assert.deepEqual(out.map((c) => c.verified), [true, false]);
});

test("a failed first batch leaves every candidate unverified instead of failing the run", async () => {
  const { mb } = fakeMusicBrainz(new Error("down"), new Error("down"));
  const out = await verifyCandidatesWithMusicBrainz(mb, [extracted("Fen")], []);
  assert.deepEqual(out.map((c) => c.verified), [false]);
});

test("no second batch starts once the research time is over", async () => {
  const { mb, asked } = fakeMusicBrainz([]);
  await verifyCandidatesWithMusicBrainz(mb, [extracted("Fen")], [], { shouldContinue: () => false });
  assert.equal(asked.length, 0);
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
  const fromRound2 = { name: "Portrayal of Guilt", canonicalName: "Portrayal of Guilt", mbid: "mbid-pog", verified: true, evidenceUrls: ["https://b.example"], evidenceSnippets: ["b"], sourceQueries: ["q2"], mbTags: ["screamo"] };
  const result = mergeVerifiedCandidates([fromRound1, fromRound2]);
  assert.equal(result.length, 1);
  assert.equal(result[0].verified, true);
  assert.equal(result[0].mbid, "mbid-pog");
});

// ─── filterCandidatesByObscurity (#325: floor, ceiling, near misses) ─────────

test("an artist verified before is not searched again, and neither is one MusicBrainz does not know", async () => {
  const cache = createResearchCache().artists;
  const first = fakeMusicBrainz([record({ name: "Fen" })], []);
  await verifyCandidatesWithMusicBrainz(first.mb, [extracted("Fen"), extracted("Unknown Act")], [], { cache });

  const second = fakeMusicBrainz([record({ name: "Capra" })]);
  const out = await verifyCandidatesWithMusicBrainz(
    second.mb, [extracted("FEN"), extracted("Unknown Act"), extracted("Capra")], [], { cache },
  );
  assert.deepEqual(second.asked, [{ names: ["Capra"], includeAliases: false }]);
  assert.deepEqual(out.map((c) => c.verified), [true, false, true]);
});

test("a failed search is not remembered as an unknown artist", async () => {
  const cache = createResearchCache().artists;
  const down = fakeMusicBrainz(new Error("down"), new Error("down"));
  await verifyCandidatesWithMusicBrainz(down.mb, [extracted("Fen")], [], { cache });

  const up = fakeMusicBrainz([record({ name: "Fen" })]);
  const out = await verifyCandidatesWithMusicBrainz(up.mb, [extracted("Fen")], [], { cache });
  assert.equal(out[0]!.verified, true);
});

function makeCandidate(name: string, listenerCount: number | null): VerifiedCandidate {
  return { name, listenerCount, verified: true, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [] };
}

const names = (cs: VerifiedCandidate[]) => cs.map((c) => c.name);

test("without an obscurity target every candidate reaches the ranker", () => {
  const candidates = [makeCandidate("Huge", 1_000_000), makeCandidate("Tiny", 100)];
  assert.deepEqual(names(filterCandidatesByObscurity(candidates)), ["Huge", "Tiny"]);
});

test("far misses are dropped in both directions: more than ten times off the range", () => {
  const candidates = [
    makeCandidate("Far too obscure", 900),
    makeCandidate("Cult A", 30_000),
    makeCandidate("Cult B", 120_000),
    makeCandidate("Far too mainstream", 6_000_000),
    makeCandidate("Cult C", 20_000),
    makeCandidate("Cult D", 500_000),
    makeCandidate("Cult E", 75_000),
  ];
  assert.deepEqual(
    names(filterCandidatesByObscurity(candidates, "cult")),
    ["Cult A", "Cult B", "Cult C", "Cult D", "Cult E"],
  );
});

test("near misses stay in the pool behind the in-range candidates, for the ranker to weigh against the query", () => {
  // A query's hard constraint ("from Japan") may only be met just outside the
  // range; the filter cannot see constraints, the ranker can.
  const candidates = [
    makeCandidate("Just too obscure", 15_000),
    makeCandidate("Cult A", 30_000),
    makeCandidate("Cult B", 120_000),
    makeCandidate("Bit too mainstream", 900_000),
    makeCandidate("Cult C", 20_000),
    makeCandidate("Far too obscure", 900),
    makeCandidate("Cult D", 500_000),
    makeCandidate("Cult E", 75_000),
  ];
  assert.deepEqual(
    names(filterCandidatesByObscurity(candidates, "cult")),
    ["Cult A", "Cult B", "Cult C", "Cult D", "Cult E", "Just too obscure", "Bit too mainstream"],
  );
});

test("ten times off the range is still near; beyond that it is far", () => {
  const candidates = [
    ...["A", "B", "C", "D", "E"].map((n) => makeCandidate(`Cult ${n}`, 100_000)),
    makeCandidate("Floor / 10", 2_000),
    makeCandidate("Below floor / 10", 1_999),
    makeCandidate("Ceiling x 10", 5_000_000),
    makeCandidate("Above ceiling x 10", 5_000_001),
  ];
  assert.deepEqual(
    names(filterCandidatesByObscurity(candidates, "cult")).slice(5),
    ["Floor / 10", "Ceiling x 10"],
  );
});

test("with too few in range or near it, the nearest far misses fill up the ranker's pool", () => {
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
