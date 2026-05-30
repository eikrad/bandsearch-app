const test = require("node:test");
const assert = require("node:assert/strict");

const {
  whyContainsEvidenceCitation,
  attachEvidenceCitationsToRecommendations,
  formatEvidenceForPrompt,
} = require("../../src/agent/research/recommendationRanker");

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
        mbUrls: [],
      },
    ],
  );
  assert.equal(recs.length, 1);
  assert.match(String(recs[0].why), /https:\/\/source\.example\/a/);
  assert.equal(recs[0].musicbrainzArtistId, "mbid-1");
  assert.equal(recs[0].sourceSignals.includes("web_search"), true);
});

test("createRecommendationRanker is imported", async () => {
  const { createRecommendationRanker } = require("../../src/agent/research/recommendationRanker");
  await assert.rejects(() => createRecommendationRanker({ apiKey: "  " }), /apiKey is required/);
});

test("formatEvidenceForPrompt deduplicates same mbid — artist block appears once", () => {
  const a = { name: "Capra", mbid: "mbid-capra", verified: true, evidenceUrls: ["https://a.example"], evidenceSnippets: ["s1"], sourceQueries: ["q1"], mbTags: ["hardcore"], mbGenres: [] };
  const b = { name: "capra", mbid: "mbid-capra", verified: true, evidenceUrls: ["https://b.example"], evidenceSnippets: ["s2"], sourceQueries: ["q2"], mbTags: ["hardcore"], mbGenres: [] };
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
