import test from "node:test";
import assert from "node:assert/strict";

import { buildReflectionSubgraph } from "../../src/agent/research/reflectionSubgraph.js";
import { createResearchBudget } from "../../src/agent/research/researchBudget.js";
import type { MusicBrainzVerifyClient, VerifiedCandidate } from "../../src/agent/research/candidateVerifier.js";
import type { SearchHitInput } from "../../src/agent/research/candidateExtractor.js";
import { extractedCandidates, fakeModelClient } from "../helpers/researchGraphHarness.js";

/**
 * The reflection loop's routing.
 *
 * All of the pipeline's conditional edges live here — the main graph is a
 * straight line. Three separate conditions can end the loop (the reflector says
 * it has enough, the round cap is reached, or the remaining time budget is
 * below one cycle) and none of them had a test, so the budget guard that keeps
 * a slow run from overshooting its deadline was unverified.
 */

const MIN_REFLECTION_CYCLE_MS = 25_000;

function verified(name: string, isVerified = true): VerifiedCandidate {
  return {
    name,
    evidenceUrls: [`https://blog.example/${name.toLowerCase()}`],
    evidenceSnippets: [`${name} is good`],
    sourceQueries: ["q"],
    verified: isVerified,
    canonicalName: name,
    mbid: `mbid-${name.toLowerCase()}`,
  };
}

const mbClient: MusicBrainzVerifyClient = {
  async searchArtists(q) {
    return [{ id: `mbid-${q.toLowerCase()}`, name: q, score: 100 }];
  },
  async lookupArtist(mbid) {
    return {
      id: mbid,
      name: mbid.replace("mbid-", ""),
      tags: [],
      genres: [],
      urls: [],
      lifeSpan: { ended: false },
    };
  },
};

const hit: SearchHitInput = {
  sourceQuery: "extra query",
  title: "More blackgaze",
  url: "https://blog.example/more",
  description: "Try Downfall of Gaia.",
};

type RunOptions = {
  reflect?: () => unknown;
  budgetMs?: number;
  maxRounds?: number;
  initialVerified?: VerifiedCandidate[];
  roundsCompleted?: number;
};

async function runSubgraph({
  reflect = () => ({ sufficient: false, gaps: ["too few"], extraQueries: ["extra query"] }),
  budgetMs = 120_000,
  maxRounds = 2,
  initialVerified = [verified("Fen")],
  roundsCompleted = 0,
}: RunOptions = {}) {
  const searchCalls: string[][] = [];
  const logs: { level: string; event: string }[] = [];

  const { client } = fakeModelClient({
    reflect,
    extract: () => extractedCandidates([
      { name: "Downfall of Gaia", evidenceUrls: ["https://blog.example/more"] },
    ]),
  });

  const subgraph = buildReflectionSubgraph({
    geminiApiKey: "",
    modelClient: client,
    mb: mbClient,
    runQueries: async (queries) => {
      searchCalls.push(queries);
      return { hits: [hit], calls: queries.length };
    },
    budget: createResearchBudget(budgetMs),
    maxRounds,
    maxReflectionSearches: 2,
    targetVerifiedCount: 4,
    totalSearchBudget: 10,
    onLog: (level, event) => logs.push({ level, event }),
  });

  const result = await subgraph.invoke({
    braveHits: [],
    newHits: [],
    verifiedCandidates: initialVerified,
    extractedCandidates: [],
    searchCallsUsed: 0,
    searchPlan: { anchorArtists: ["Alcest"], styleSignals: [], mustHave: [], avoid: [], queries: [] },
    userQuery: "bands like Alcest",
    reflectionUsed: false,
    roundsCompleted,
    nextExtraQueries: [],
  });

  return { result, searchCalls, logs };
}

// --------------------------------------------------------- assess routing

test("reflection ends immediately when the reflector reports enough candidates", async () => {
  const { result, searchCalls } = await runSubgraph({
    reflect: () => ({ sufficient: true, gaps: [], extraQueries: [] }),
  });

  assert.equal(searchCalls.length, 0, "a sufficient assessment must not spend a search call");
  assert.equal(result.reflectionUsed, true);
  assert.equal(result.roundsCompleted, 0);
});

test("reflection ends when the reflector proposes no extra queries", async () => {
  const { searchCalls } = await runSubgraph({
    reflect: () => ({ sufficient: false, gaps: ["thin"], extraQueries: [] }),
  });

  // "not sufficient" with nothing to search is still a dead end.
  assert.equal(searchCalls.length, 0);
});

test("reflection searches again when the reflector asks for more", async () => {
  const { result, searchCalls } = await runSubgraph();

  assert.ok(searchCalls.length >= 1, "expected at least one reflection search");
  assert.deepEqual(searchCalls[0], ["extra query"]);
  assert.ok(result.roundsCompleted >= 1);
});

test("reflection merges newly verified candidates into the existing set", async () => {
  const { result } = await runSubgraph();

  const names = (result.verifiedCandidates as VerifiedCandidate[]).map((c) => c.name);
  assert.ok(names.includes("Fen"), "the candidate carried in must survive");
  assert.ok(names.includes("Downfall of Gaia"), "the candidate found by reflection must be added");
});

test("reflection caps extra queries at maxReflectionSearches", async () => {
  const { searchCalls } = await runSubgraph({
    reflect: () => ({ sufficient: false, gaps: [], extraQueries: ["q1", "q2", "q3", "q4"] }),
  });

  assert.equal(searchCalls[0].length, 2, "maxReflectionSearches is 2");
});

// ---------------------------------------------------------- budget guard

test("reflection skips searching when the remaining budget is under one cycle", async () => {
  const { searchCalls, logs } = await runSubgraph({ budgetMs: MIN_REFLECTION_CYCLE_MS - 1000 });

  // The whole point of the research budget: stop before starting work that
  // cannot finish inside the deadline.
  assert.equal(searchCalls.length, 0);
  assert.ok(logs.some((l) => l.event === "research_reflection_skipped_budget"));
  assert.ok(logs.some((l) => l.event === "research_reflection_skipped_budget" && l.level === "warn"));
});

test("reflection still records that it ran when the budget cuts it short", async () => {
  const { result } = await runSubgraph({ budgetMs: MIN_REFLECTION_CYCLE_MS - 1000 });

  assert.equal(result.reflectionUsed, true);
  assert.equal(result.roundsCompleted, 0);
});

// ------------------------------------------------------------ round cap

test("reflection stops at maxRounds", async () => {
  const { result, searchCalls } = await runSubgraph({ maxRounds: 1 });

  assert.equal(result.roundsCompleted, 1);
  assert.equal(searchCalls.length, 1, "one round means exactly one search fan-out");
});

test("reflection loops up to maxRounds when the reflector keeps asking", async () => {
  const { result, searchCalls } = await runSubgraph({ maxRounds: 3 });

  assert.equal(result.roundsCompleted, 3);
  assert.equal(searchCalls.length, 3);
});

test("reflection stops mid-loop when the budget drains during a round", async () => {
  const searchCalls: string[][] = [];

  // `ResearchBudget` is a plain interface, so a scripted one makes the second
  // guard — the one on verify_r — deterministic instead of clock-racy. Tying
  // the drain to "a search has happened" avoids depending on how many times
  // the graph asks for the remaining time.
  const drainingBudget = {
    allocate: (cap: number) => cap,
    remaining: () => (searchCalls.length === 0 ? 120_000 : 1_000),
  };

  const logs: { level: string; event: string }[] = [];
  const { client } = fakeModelClient({
    reflect: () => ({ sufficient: false, gaps: ["thin"], extraQueries: ["extra query"] }),
    extract: () => extractedCandidates([
      { name: "Downfall of Gaia", evidenceUrls: ["https://blog.example/more"] },
    ]),
  });

  const subgraph = buildReflectionSubgraph({
    geminiApiKey: "",
    modelClient: client,
    mb: mbClient,
    runQueries: async (queries) => {
      searchCalls.push(queries);
      return { hits: [hit], calls: queries.length };
    },
    budget: drainingBudget,
    maxRounds: 5,
    maxReflectionSearches: 2,
    targetVerifiedCount: 4,
    totalSearchBudget: 10,
    onLog: (level, event) => logs.push({ level, event }),
  });

  const result = await subgraph.invoke({
    braveHits: [],
    newHits: [],
    verifiedCandidates: [verified("Fen")],
    extractedCandidates: [],
    searchCallsUsed: 0,
    searchPlan: { anchorArtists: ["Alcest"], styleSignals: [], mustHave: [], avoid: [], queries: [] },
    userQuery: "bands like Alcest",
    reflectionUsed: false,
    roundsCompleted: 0,
    nextExtraQueries: [],
  });

  // maxRounds is 5, so only the drained budget can have stopped it at 1.
  assert.equal(result.roundsCompleted, 1);
  assert.equal(searchCalls.length, 1);
  assert.ok(logs.some((l) => l.event === "research_reflection_skipped_budget" && l.level === "warn"));
});

test("reflection ends immediately when it starts at the round cap", async () => {
  const { result, searchCalls } = await runSubgraph({ maxRounds: 2, roundsCompleted: 2 });

  // verify_r routes to END on the round check before spending anything more,
  // but assess still runs once because START goes straight to it.
  assert.equal(searchCalls.length, 1);
  assert.equal(result.roundsCompleted, 3);
});

// ------------------------------------------------------------- accounting

test("reflection adds its search calls to the running total", async () => {
  const { result } = await runSubgraph({ maxRounds: 2 });

  // Two rounds, one query each.
  assert.equal(result.searchCallsUsed, 2);
});

test("reflection accumulates new hits onto braveHits", async () => {
  const { result } = await runSubgraph({ maxRounds: 2 });

  assert.equal((result.braveHits as SearchHitInput[]).length, 2);
  assert.deepEqual(result.newHits, [hit]);
});
