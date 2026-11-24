import test from "node:test";
import assert from "node:assert/strict";
import { whyContainsEvidenceCitation, attachEvidenceCitationsToRecommendations, formatEvidenceForPrompt, buildRankUserPartsForTest } from "../../src/agent/research/recommendationRanker.js";
import type { VerifiedCandidate } from "../../src/agent/research/candidateVerifier.js";
import { assertRecord } from "../helpers/typeAssertions.js";

test("whyContainsEvidenceCitation matches full url or host", () => {
  assert.equal(
    whyContainsEvidenceCitation("Described on https://blog.example/post", ["https://blog.example/post"]),
    true,
  );
  assert.equal(whyContainsEvidenceCitation("No url here", ["https://z.example"]), false);
  assert.equal(
    whyContainsEvidenceCitation("listed on artist.bandcamp.com", ["https://artist.bandcamp.com/x"]),
    true,
  );
});

test("attachEvidenceCitationsToRecommendations appends see url when why lacks citation", () => {
  const recs = attachEvidenceCitationsToRecommendations(
    [
      {
        artist: "Test Band",
        why: "Great hardcore",
        sourceSignals: ["agent_reasoning"],
      },
    ],
    [
      {
        name: "Test Band",
        evidenceUrls: ["https://source.example/a"],
        evidenceSnippets: ["x"],
        sourceQueries: ["q"],
        verified: true,
        mbid: "mbid-1",
      },
    ],
  );
  assert.equal(recs.length, 1);
  assertRecord(recs[0]);
  assert.match(String(recs[0].why), /https:\/\/source\.example\/a/);
  assert.equal(recs[0].musicbrainzArtistId, "mbid-1");
  assert.ok(Array.isArray(recs[0].sourceSignals));
  assert.equal(recs[0].sourceSignals.includes("web_search"), true);
});


// ─── #325: the ranker ranks by the same range the filter and eval use ─────────

function candidate(name: string, listenerCount: number | null) {
  return { name, listenerCount, verified: true, evidenceUrls: [`https://${name}.example`], evidenceSnippets: [], sourceQueries: [] };
}

test("the ranker is told the target's listener range and that a pick below it misses as much as one above", () => {
  const ranges = { cult: "20,000–500,000", underground: "2,000–50,000", obscure: "0–5,000" } as const;
  for (const [target, range] of Object.entries(ranges)) {
    const joined = buildRankUserPartsForTest({ query: "heavy bands", mode: "fresh", obscurityTarget: target }).join("\n");
    assert.ok(joined.includes(`obscurity_rank (${target})`), `${target}: the constraint is present`);
    assert.ok(joined.includes(range), `${target}: the range ${range} is stated`);
    assert.match(joined, /below the range is as wrong as one above/i, `${target}: both directions`);
  }
});

test("each candidate in the ranker's evidence carries its fit, by the filter's rule", () => {
  const joined = buildRankUserPartsForTest({
    query: "heavy bands",
    mode: "fresh",
    obscurityTarget: "cult",
    candidates: [candidate("Small", 3_000), candidate("Scene", 40_000), candidate("Nocount", null)],
  }).join("\n");
  const fitOf = (name: string) => new RegExp(`artist: ${name}[\\s\\S]*?target_range_fit: (\\w+)`).exec(joined)?.[1];
  assert.equal(fitOf("Small"), "tooObscure");
  assert.equal(fitOf("Scene"), "inRange");
  assert.equal(fitOf("Nocount"), "tooObscure");
});

test("without a target the evidence carries no range fit", () => {
  const joined = buildRankUserPartsForTest({ query: "q", mode: "fresh", candidates: [candidate("Small", 3_000)] }).join("\n");
  assert.doesNotMatch(joined, /target_range_fit/);
});

test("buildRankUserPartsForTest omits obscurity constraint when no target", () => {
  const parts = buildRankUserPartsForTest({ query: "heavy bands", mode: "fresh" });
  const joined = parts.join("\n");
  assert.doesNotMatch(joined, /obscurity_rank:/i);
});

test("formatEvidenceForPrompt deduplicates same mbid — artist block appears once", () => {
  const a = { name: "Capra", mbid: "mbid-capra", verified: true, evidenceUrls: ["https://a.example"], evidenceSnippets: ["s1"], sourceQueries: ["q1"], mbTags: ["hardcore"] };
  const b = { name: "capra", mbid: "mbid-capra", verified: true, evidenceUrls: ["https://b.example"], evidenceSnippets: ["s2"], sourceQueries: ["q2"], mbTags: ["hardcore"] };
  const output = formatEvidenceForPrompt([a, b]);
  const matches = output.match(/artist:/g) ?? [];
  assert.equal(matches.length, 1);
});

test("formatEvidenceForPrompt deduplicates same name different casing when no mbid", () => {
  const a = { name: "Vein.fm", verified: false, evidenceUrls: ["https://x.example"], evidenceSnippets: ["x"], sourceQueries: ["q1"] };
  const b = { name: "vein.fm", verified: false, evidenceUrls: ["https://y.example"], evidenceSnippets: ["y"], sourceQueries: ["q2"] };
  const output = formatEvidenceForPrompt([a, b]);
  const matches = output.match(/artist:/g) ?? [];
  assert.equal(matches.length, 1);
});

test("formatEvidenceForPrompt preserves all distinct artists", () => {
  const input = [
    { name: "Band A", mbid: "mbid-a", verified: true, evidenceUrls: ["https://a.example"], evidenceSnippets: ["s"], sourceQueries: ["q"] },
    { name: "Band B", mbid: "mbid-b", verified: true, evidenceUrls: ["https://b.example"], evidenceSnippets: ["s"], sourceQueries: ["q"] },
    { name: "Band C", mbid: "mbid-c", verified: false, evidenceUrls: ["https://c.example"], evidenceSnippets: ["s"], sourceQueries: ["q"] },
  ];
  const output = formatEvidenceForPrompt(input);
  const matches = output.match(/artist:/g) ?? [];
  assert.equal(matches.length, 3);
});

test("a verified candidate without a source URL is attributed to its MusicBrainz record", () => {
  const recs = attachEvidenceCitationsToRecommendations(
    [{ artist: "Capra", why: "Great riffs", sourceSignals: [] }],
    [{ name: "Capra", mbid: "mbid-capra", verified: true, evidenceUrls: [], evidenceSnippets: ["great"], sourceQueries: [] }],
  ) as Array<{ why: string }>;
  assert.equal(recs[0]!.why, "Great riffs (see https://musicbrainz.org/artist/mbid-capra)");
});

test("the ranker sees a band's country, so a request for one can be met", () => {
  const evidence = formatEvidenceForPrompt([
    { name: "Anoice", country: "JP", verified: true, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [] },
    { name: "Unknown", country: null, verified: true, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [] },
  ]);
  assert.match(evidence, /artist: Anoice[\s\S]*country: JP/);
  assert.equal(evidence.match(/country:/g)?.length, 1);
});

test("a pick says where it was found, whatever the model claims", () => {
  const candidate = (name: string, sourceQueries: string[]): VerifiedCandidate =>
    ({ name, verified: true, evidenceUrls: ["https://a.example"], evidenceSnippets: [], sourceQueries });
  const recs = attachEvidenceCitationsToRecommendations(
    ["Similar", "Web", "Both"].map((artist) => ({ artist, why: "Good", sourceSignals: ["agent_reasoning", "web_search", "lastfm_similarity"] })),
    [candidate("Similar", ["last.fm similar to Alcest"]), candidate("Web", ["ffo alcest"]), candidate("Both", ["last.fm similar to Alcest", "ffo alcest"])],
  ) as Array<{ sourceSignals: string[] }>;
  assert.deepEqual(recs.map((r) => r.sourceSignals.filter((s) => s === "web_search" || s === "lastfm_similarity")), [
    ["lastfm_similarity"], ["web_search"], ["web_search"],
  ]);
});

test("a pick spelled differently from its candidate is still attributed to it (#366)", () => {
  const recs = attachEvidenceCitationsToRecommendations(
    [{ artist: "Alcest", why: "Shoegaze and black metal", sourceSignals: [] }],
    [{ name: "Alcést", canonicalName: "Alcést", evidenceUrls: ["https://source.example/a"], evidenceSnippets: [], sourceQueries: [], verified: true, mbid: "mbid-alcest" }],
  );
  assert.equal(recs.length, 1);
  assertRecord(recs[0]);
  assert.equal(recs[0].musicbrainzArtistId, "mbid-alcest");
});
