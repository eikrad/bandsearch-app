import test from "node:test";
import assert from "node:assert/strict";
import { createCandidateExtractor, mergeExtractedCandidates, buildExtractorSystemPrompt, type SearchHitInput } from "../../src/agent/research/candidateExtractor.js";

const hits: SearchHitInput[] = [
  { sourceQuery: "ffo nora", title: "Ten bands like Nora", url: "https://a.example", description: "Fans of Nora should hear <strong>Capra</strong> &amp; Grade." },
  { sourceQuery: "metalcore bandcamp", title: "Capra | Bandcamp", url: "https://capra.bandcamp.com", description: "Hardcore from Louisiana." },
];

/** The extractor, with a model that gives these answers one after the other. */
async function extractWith(answers: unknown[], input: { hits?: SearchHitInput[]; anchorArtists?: string[] } = {}) {
  const prompts: string[] = [];
  const extract = await createCandidateExtractor({
    modelClient: {
      async invoke(prompt) {
        prompts.push(prompt.map((p) => p.content).join("\n"));
        return { content: JSON.stringify(answers[prompts.length - 1] ?? { candidates: [] }) };
      },
    },
  });
  const candidates = await extract({ hits: input.hits ?? hits, anchorArtists: input.anchorArtists ?? [] });
  return { candidates, prompts };
}

test("the model names the hits a band appears in, and the evidence comes from those hits word for word", async () => {
  // The model used to copy URLs and snippets into its answer: 2,000 output
  // tokens, most of an extraction's time, and free to misquote.
  const { candidates, prompts } = await extractWith([{ candidates: [{ name: "Capra", hits: [1, 2] }] }]);
  assert.deepEqual(candidates, [{
    name: "Capra",
    evidenceUrls: ["https://a.example", "https://capra.bandcamp.com"],
    evidenceSnippets: ["Fans of Nora should hear Capra & Grade.", "Capra | Bandcamp"],
    sourceQueries: ["ffo nora", "metalcore bandcamp"],
  }]);
  assert.match(prompts[0]!, /number: 1\n.*ffo nora/);
  assert.match(prompts[0]!, /number: 2\n.*metalcore bandcamp/);
});

test("a long description is cut to the words around the band's name", async () => {
  const description = `${"x ".repeat(200)}then Capra came along ${"y ".repeat(200)}`;
  const { candidates } = await extractWith(
    [{ candidates: [{ name: "Capra", hits: [1] }] }],
    { hits: [{ ...hits[0]!, description }] },
  );
  const snippet = candidates[0]!.evidenceSnippets[0]!;
  assert.match(snippet, /then Capra came along/);
  assert.ok(snippet.length <= 200, `snippet has ${snippet.length} characters`);
});

test("a band whose hits do not exist has no evidence and is dropped", async () => {
  const { candidates } = await extractWith([{
    candidates: [{ name: "Invented", hits: [9] }, { name: "No hits" }, { name: "Capra", hits: ["1", 2, 2, 0] }],
  }]);
  assert.deepEqual(candidates.map((c) => c.name), ["Capra"]);
  assert.deepEqual(candidates[0]!.evidenceUrls, ["https://a.example", "https://capra.bandcamp.com"]);
});

test("a band listed twice is one candidate with the evidence of both", async () => {
  const { candidates } = await extractWith([{ candidates: [{ name: "Capra", hits: [1] }, { name: "capra", hits: [2] }] }]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.evidenceUrls.length, 2);
});

test("anchor artists are not candidates", async () => {
  const { candidates } = await extractWith(
    [{ candidates: [{ name: "Grade", hits: [1] }, { name: "Capra", hits: [1] }] }],
    { anchorArtists: ["GRADE"] },
  );
  assert.deepEqual(candidates.map((c) => c.name), ["Capra"]);
});

test("an answer without candidates is asked for once more", async () => {
  const { candidates, prompts } = await extractWith([{ bands: [] }, { candidates: [{ name: "Capra", hits: [1] }] }]);
  assert.equal(prompts.length, 2);
  assert.equal(candidates.length, 1);
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

test("buildExtractorSystemPrompt instructs the model to cap the candidate count", () => {
  const prompt = buildExtractorSystemPrompt(25);
  assert.ok(prompt.includes("25"), "prompt should mention the cap number");
  assert.ok(/at most/i.test(prompt), "prompt should instruct an upper bound");
});
