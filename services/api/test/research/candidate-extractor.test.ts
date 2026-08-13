import test from "node:test";
import assert from "node:assert/strict";
import { tryParseExtractedCandidatesFromModelText, mergeExtractedCandidates, buildExtractorSystemPrompt } from "../../src/agent/research/candidateExtractor.js";

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

test("mergeExtractedCandidates deduplicates case-insensitively and merges evidence arrays", () => {
  const round1 = [
    { name: "Capra", evidenceUrls: ["https://a.example"], evidenceSnippets: ["FFO Nora"], sourceQueries: ["q1"] },
  ];
  const round2 = [
    { name: "capra", evidenceUrls: ["https://b.example"], evidenceSnippets: ["great"], sourceQueries: ["q2"] },
    { name: "Portrayal of Guilt", evidenceUrls: ["https://c.example"], evidenceSnippets: ["post-metal"], sourceQueries: ["q2"] },
  ];
  const result = mergeExtractedCandidates([...round1, ...round2]);
  assert.equal(result.length, 2);
  const capra = result.find((r) => r.name.toLowerCase() === "capra");
  assert.ok(capra);
  assert.equal(capra.evidenceUrls.length, 2);
  assert.deepEqual(new Set(capra.sourceQueries), new Set(["q1", "q2"]));
});

test("mergeExtractedCandidates preserves all entries when there is no overlap", () => {
  const input = [
    { name: "Vein.fm", evidenceUrls: ["https://x.example"], evidenceSnippets: ["chaotic"], sourceQueries: ["q1"] },
    { name: "Show Me the Body", evidenceUrls: ["https://y.example"], evidenceSnippets: ["punk"], sourceQueries: ["q2"] },
  ];
  const result = mergeExtractedCandidates(input);
  assert.equal(result.length, 2);
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

test("buildExtractorSystemPrompt instructs the model to cap the candidate count", () => {
  const prompt = buildExtractorSystemPrompt(25);
  assert.ok(prompt.includes("25"), "prompt should mention the cap number");
  assert.ok(/at most/i.test(prompt), "prompt should instruct an upper bound");
});
