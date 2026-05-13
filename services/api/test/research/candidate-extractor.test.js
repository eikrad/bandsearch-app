const test = require("node:test");
const assert = require("node:assert/strict");

const { tryParseExtractedCandidatesFromModelText } = require("../../src/agent/research/candidateExtractor");

test("tryParseExtractedCandidatesFromModelText merges duplicates case-insensitively", () => {
  const raw = JSON.stringify({
    candidates: [
      {
        name: "Capra",
        evidenceUrls: ["https://a.example"],
        evidenceSnippets: ["FFO Nora"],
        sourceQueries: ["q1"],
      },
      {
        name: "capra",
        evidenceUrls: ["https://b.example"],
        evidenceSnippets: ["great"],
        sourceQueries: ["q2"],
      },
    ],
  });
  const rows = tryParseExtractedCandidatesFromModelText(raw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].evidenceUrls.length, 2);
});

test("tryParseExtractedCandidatesFromModelText excludes anchors", () => {
  const raw = JSON.stringify({
    candidates: [
      {
        name: "Grade",
        evidenceUrls: ["https://x"],
        evidenceSnippets: ["anchor"],
        sourceQueries: ["q"],
      },
      {
        name: "Other Band",
        evidenceUrls: ["https://y"],
        evidenceSnippets: ["pick"],
        sourceQueries: ["q"],
      },
    ],
  });
  const rows = tryParseExtractedCandidatesFromModelText(raw, ["Grade"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Other Band");
});
