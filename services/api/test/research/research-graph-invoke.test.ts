import test from "node:test";
import assert from "node:assert/strict";

import { invokeResearchGraph } from "../../src/agent/research/researchGraph.js";
import {
  braveResults,
  extractedCandidates,
  fakeFetch,
  fakeModelClient,
  graphDeps,
  musicbrainzArtist,
  musicbrainzArtists,
  rankedRecommendations,
} from "../helpers/researchGraphHarness.js";

/**
 * The research graph, actually run.
 *
 * research-graph.test.ts only asserts the graph compiles, so until now no test
 * had ever executed a node body: not the planner, the Brave fan-out, the
 * extractor, MusicBrainz verification, Last.fm enrichment or the ranker.
 * These drive the whole thing with fakes for all four upstreams.
 */

const input = {
  userQuery: "bands like Alcest but more obscure",
  preferenceContext: "",
  messages: [],
  mode: "fresh" as const,
};

const twoBraveHits = braveResults([
  { title: "FFO Alcest", url: "https://blog.example/ffo-alcest", description: "Try Fen and Ghost Bath." },
  { title: "Blackgaze roundup", url: "https://blog.example/blackgaze", description: "Fen remain underrated." },
]);

/** A run that verifies both candidates and ranks one of them. */
function happyPath(overrides: Parameters<typeof fakeModelClient>[0] = {}) {
  const { client, calls } = fakeModelClient({
    extract: () => extractedCandidates([
      { name: "Fen", evidenceUrls: ["https://blog.example/ffo-alcest"] },
      { name: "Ghost Bath", evidenceUrls: ["https://blog.example/blackgaze"] },
    ]),
    rank: () => rankedRecommendations([
      { artist: "Fen", why: "Post-black, see https://blog.example/ffo-alcest" },
    ]),
    ...overrides,
  });

  const { fetchImpl, log } = fakeFetch({
    brave: () => twoBraveHits,
    musicbrainzSearch: (url) =>
      musicbrainzArtists([
        url.includes("Fen")
          ? { id: "mbid-fen", name: "Fen" }
          : { id: "mbid-ghost", name: "Ghost Bath" },
      ]),
    musicbrainzLookup: (url) =>
      url.includes("mbid-fen")
        ? musicbrainzArtist({ id: "mbid-fen", name: "Fen" })
        : musicbrainzArtist({ id: "mbid-ghost", name: "Ghost Bath" }),
  });

  return { client, calls, fetchImpl, log };
}

// ------------------------------------------------------------ happy path

test("invokeResearchGraph runs plan → search → extract → verify → rank", async () => {
  const { client, fetchImpl } = happyPath();

  const result = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl }),
    input,
  );

  assert.equal(result.recommendations.length, 1);
  assert.equal((result.recommendations[0] as { artist: string }).artist, "Fen");
  assert.match(result.assistantReply, /picks/);
});

/** Which node a recorded model call came from, by its system prompt. */
function nodeOf(system: string): string {
  if (system.startsWith("You plan Brave web searches")) return "plan";
  if (system.startsWith("You extract band or artist names")) return "extract";
  if (system.startsWith("You evaluate whether web search found enough")) return "reflect";
  if (system.startsWith("You recommend niche bands")) return "rank";
  return "unknown";
}

test("invokeResearchGraph visits every node in order", async () => {
  const { client, calls, fetchImpl } = happyPath();

  await invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl }), input);

  assert.deepEqual(calls.map((c) => nodeOf(c.system)), ["plan", "extract", "reflect", "rank"]);
});

test("invokeResearchGraph reports pipeline diagnostics from the run", async () => {
  const { client, fetchImpl } = happyPath();

  const { pipelineDiagnostics } = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl }),
    input,
  );

  assert.equal(pipelineDiagnostics.braveHitCount, 2);
  assert.equal(pipelineDiagnostics.extractedCandidateCount, 2);
  assert.equal(pipelineDiagnostics.verifiedCount, 2);
  assert.equal(pipelineDiagnostics.searchBudgetUsed, 1);
  assert.equal(pipelineDiagnostics.reflectionTriggered, true);
});

test("invokeResearchGraph caps initial searches at maxInitialSearches", async () => {
  const { client, fetchImpl, log } = happyPath({
    plan: () => ({
      anchorArtists: ["Alcest"],
      styleSignals: [],
      mustHave: [],
      avoid: [],
      queries: ["q1", "q2", "q3", "q4", "q5"],
    }),
  });

  await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, maxInitialSearches: 2 }),
    input,
  );

  const braveCalls = log.filter((c) => c.url.includes("api.search.brave.com"));
  assert.equal(braveCalls.length, 2, "planner offered five queries; only two are in budget");
});

test("invokeResearchGraph passes the user query through to the planner", async () => {
  const { client, calls, fetchImpl } = happyPath();

  await invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl }), input);

  assert.match(calls[0].user, /bands like Alcest but more obscure/);
});

// ---------------------------------------------------------- verification

test("invokeResearchGraph drops candidates MusicBrainz cannot confirm", async () => {
  const { client } = fakeModelClient({
    extract: () => extractedCandidates([
      { name: "Not A Real Band", evidenceUrls: ["https://blog.example/ffo-alcest"] },
    ]),
    rank: () => rankedRecommendations([]),
  });
  const { fetchImpl } = fakeFetch({
    brave: () => twoBraveHits,
    musicbrainzSearch: () => ({ artists: [] }),
  });

  const { pipelineDiagnostics, recommendations } = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl }),
    input,
  );

  // Extracted, but never verified — so it must not reach the recommendations.
  assert.equal(pipelineDiagnostics.extractedCandidateCount, 1);
  assert.equal(pipelineDiagnostics.verifiedCount, 0);
  assert.deepEqual(recommendations, []);
});

test("invokeResearchGraph drops extracted candidates that carry no evidence", async () => {
  const { client } = fakeModelClient({
    // No evidenceUrls and no evidenceSnippets: the extractor discards these
    // before verification, so an unsupported name never reaches MusicBrainz.
    extract: () => extractedCandidates([{ name: "Unsupported Name" }]),
    rank: () => rankedRecommendations([]),
  });
  const { fetchImpl, log } = fakeFetch({ brave: () => twoBraveHits });

  const { pipelineDiagnostics } = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl }),
    input,
  );

  assert.equal(pipelineDiagnostics.extractedCandidateCount, 0);
  assert.equal(log.filter((c) => c.url.includes("musicbrainz.org")).length, 0);
});

test("invokeResearchGraph returns a well-formed response when nothing is found", async () => {
  const { client } = fakeModelClient({ rank: () => rankedRecommendations([], "Nothing this time.") });
  const { fetchImpl } = fakeFetch({ brave: () => braveResults([]) });

  const result = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl }),
    input,
  );

  // An empty run still has to answer the HTTP request with the full shape.
  assert.deepEqual(result.recommendations, []);
  assert.equal(typeof result.assistantReply, "string");
  assert.equal(result.pipelineDiagnostics.braveHitCount, 0);
  assert.equal(result.pipelineDiagnostics.verifiedCount, 0);
});

test("invokeResearchGraph survives a ranker that returns unusable JSON", async () => {
  const { client } = happyPath({ rank: () => ({ nonsense: true }) });
  const { fetchImpl } = fakeFetch({
    brave: () => twoBraveHits,
    musicbrainzSearch: () => musicbrainzArtists([{ id: "mbid-fen", name: "Fen" }]),
    musicbrainzLookup: () => musicbrainzArtist({ id: "mbid-fen", name: "Fen" }),
  });

  await assert.rejects(
    () => invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl }), input),
    /invalid recommendation output/,
  );
});

// -------------------------------------------------------------- last.fm

test("invokeResearchGraph skips Last.fm enrichment without an API key", async () => {
  const { client, fetchImpl, log } = happyPath();

  await invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl }), input);

  assert.equal(log.filter((c) => c.url.includes("audioscrobbler")).length, 0);
});

test("invokeResearchGraph enriches candidates with Last.fm listener counts", async () => {
  const { client } = happyPath();
  const { fetchImpl, log } = fakeFetch({
    brave: () => twoBraveHits,
    musicbrainzSearch: (url) =>
      musicbrainzArtists([
        url.includes("Fen") ? { id: "mbid-fen", name: "Fen" } : { id: "mbid-ghost", name: "Ghost Bath" },
      ]),
    musicbrainzLookup: (url) =>
      url.includes("mbid-fen")
        ? musicbrainzArtist({ id: "mbid-fen", name: "Fen" })
        : musicbrainzArtist({ id: "mbid-ghost", name: "Ghost Bath" }),
    lastFm: (url) =>
      url.includes("artist.getsimilar")
        ? { similarartists: { artist: [{ name: "Fen", match: "0.9" }] } }
        : { artist: { stats: { listeners: "42000" } } },
  });

  await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, lastFmApiKey: "lastfm-key" }),
    input,
  );

  assert.ok(
    log.some((c) => c.url.includes("audioscrobbler")),
    "the enrich_lastfm node should call Last.fm when a key is configured",
  );
});

// ------------------------------------------------------------- logging

test("invokeResearchGraph emits a log event per node", async () => {
  const { client, fetchImpl } = happyPath();
  const events: string[] = [];

  await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, onLog: (_level, event) => events.push(event) }),
    input,
  );

  for (const expected of [
    "research_plan_resolved",
    "research_brave_call",
    "research_candidates_extracted",
    "research_verification_done",
    "research_obscurity_filter",
    "research_ranked",
  ]) {
    assert.ok(events.includes(expected), `expected a ${expected} log event, got ${events.join(", ")}`);
  }
});
