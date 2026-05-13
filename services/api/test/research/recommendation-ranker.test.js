const test = require("node:test");
const assert = require("node:assert/strict");

const {
  whyContainsEvidenceCitation,
  attachEvidenceCitationsToRecommendations,
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
