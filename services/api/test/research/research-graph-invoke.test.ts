import test from "node:test";
import assert from "node:assert/strict";

import { invokeResearchGraph } from "../../src/agent/research/researchGraph.js";
import {
  braveResults,
  extractedCandidates,
  fakeFetch,
  fakeModelClient,
  graphDeps,
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
      { name: "Fen", hits: [1] },
      { name: "Ghost Bath", hits: [2] },
    ]),
    rank: () => rankedRecommendations([
      { artist: "Fen", why: "Post-black, see https://blog.example/ffo-alcest" },
    ]),
    ...overrides,
  });

  const { fetchImpl, log } = fakeFetch({
    brave: () => twoBraveHits,
    musicbrainz: () => musicbrainzArtists([{ id: "mbid-fen", name: "Fen" }, { id: "mbid-ghost", name: "Ghost Bath" }]),
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

test("searching stops once the extractor has as many hits as it reads", async () => {
  const { client, calls } = fakeModelClient({
    plan: () => ({ anchorArtists: [], styleSignals: [], mustHave: [], avoid: [], queries: ["q1", "q2", "q3", "q4"] }),
  });
  const { fetchImpl, log } = fakeFetch({
    brave: (url) => braveResults([1, 2, 3].map((n) => ({
      title: `${new URL(url).searchParams.get("q")} hit ${n}`, url: `https://blog.example/${n}`, description: "",
    }))),
  });

  await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, maxInitialSearches: 4, maxExtractHits: 6 }),
    input,
  );

  assert.equal(log.filter((c) => c.url.includes("api.search.brave.com")).length, 2, "two searches filled the six hits");
  const extraction = calls.find((c) => nodeOf(c.system) === "extract")!.user;
  assert.match(extraction, /q2 hit 3/);
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
      { name: "Not A Real Band", hits: [1] },
    ]),
    rank: () => rankedRecommendations([]),
  });
  const { fetchImpl } = fakeFetch({
    brave: () => twoBraveHits,
    musicbrainz: () => ({ artists: [] }),
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
    // In none of the hits: the extractor discards these before verification,
    // so an unsupported name never reaches MusicBrainz.
    extract: () => extractedCandidates([{ name: "Unsupported Name", hits: [] }]),
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
    musicbrainz: () => musicbrainzArtists([{ id: "mbid-fen", name: "Fen" }]),
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
    musicbrainz: () => musicbrainzArtists([{ id: "mbid-fen", name: "Fen" }, { id: "mbid-ghost", name: "Ghost Bath" }]),
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

/** Last.fm naming `count` bands near Alcest, each with these listeners. */
function lastFmNaming(count: number, listeners: number) {
  const names = Array.from({ length: count }, (_, i) => `Band ${String.fromCharCode(65 + i)}`);
  return {
    names,
    lastFm: (url: string) => {
      if (url.includes("artist.getSimilar")) return { similarartists: { artist: names.map((name) => ({ name, match: "0.7" })) } };
      return { artist: { url: "https://www.last.fm/music/x", stats: { listeners: String(listeners) }, bio: { summary: "A band." } } };
    },
  };
}

async function runWithLastFm(count: number, listeners: number, overrides: Partial<Parameters<typeof invokeResearchGraph>[1]> = {}) {
  const { names, lastFm } = lastFmNaming(count, listeners);
  const { client, calls } = fakeModelClient({
    extract: () => extractedCandidates([{ name: "Fen" }, { name: "Band A" }]),
    rank: () => rankedRecommendations([{ artist: "Band A", why: "See https://www.last.fm/music/x" }]),
  });
  const { fetchImpl, log } = fakeFetch({
    brave: () => twoBraveHits,
    musicbrainz: () => musicbrainzArtists([...names, "Fen"].map((name) => ({ id: `mbid-${name}`, name }))),
    lastFm,
  });
  const result = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, lastFmApiKey: "lastfm" }),
    { ...input, obscurityTarget: "underground", ...overrides },
  );
  return {
    result,
    searches: log.filter((c) => c.url.includes("api.search.brave.com")).length,
    nodes: calls.map((c) => nodeOf(c.system)),
    evidence: calls.find((c) => nodeOf(c.system) === "rank")!.user,
  };
}

test("with enough bands of the requested size from Last.fm, the web is not searched", async () => {
  const { result, searches, nodes, evidence } = await runWithLastFm(8, 20_000);
  assert.equal(searches, 0);
  assert.deepEqual(nodes, ["plan", "rank"]);
  assert.match(evidence, /artist: Band H/);
  assert.match(evidence, /On last\.fm: A band\./);
  assert.equal(result.pipelineDiagnostics.verifiedCount, 8);
  assert.equal(result.pipelineDiagnostics.searchBudgetUsed, 0);
  const [pick] = result.recommendations as Array<{ sourceSignals: string[] }>;
  assert.ok(pick!.sourceSignals.includes("lastfm_similarity"));
  assert.equal(pick!.sourceSignals.includes("web_search"), false, "no web search found it");
});

test("with too few bands of the requested size, the web is searched and both sources are ranked", async () => {
  const { result, searches, evidence } = await runWithLastFm(3, 20_000);
  assert.ok(searches > 0);
  assert.match(evidence, /artist: Fen/, "from the web");
  assert.match(evidence, /artist: Band C/, "from Last.fm");
  assert.equal(evidence.match(/artist: Band A\n/g)?.length, 1, "named by both, one candidate");
  assert.match(evidence, /artist: Band A\n.*\nevidence_urls: [^\n]*blog\.example[^\n]*last\.fm|artist: Band A\n.*\nevidence_urls: [^\n]*last\.fm[^\n]*blog\.example/);
  const [pick] = result.recommendations as Array<{ sourceSignals: string[] }>;
  assert.ok(pick!.sourceSignals.includes("web_search"));
});

test("bands far from the requested size are not enough, and do not join the web search's", async () => {
  const { searches, evidence } = await runWithLastFm(20, 3_000_000);
  assert.ok(searches > 0);
  assert.doesNotMatch(evidence, /artist: Band B/);
});

test("for Truly Obscure the web is searched at once", async () => {
  const { searches, nodes } = await runWithLastFm(20, 900, { obscurityTarget: "obscure" });
  assert.ok(searches > 0);
  assert.deepEqual(nodes.slice(0, 2), ["plan", "extract"]);
});

test("bands the user has seen do not count as enough", async () => {
  const seen = new Set(["band a", "band b", "band c"]);
  const { searches } = await runWithLastFm(9, 20_000, { excludeNames: seen });
  assert.ok(searches > 0);
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

test("the obscurity filter log shows where candidates fall against the target range, before and after filtering (#325)", async () => {
  const { client } = happyPath();
  const { fetchImpl } = fakeFetch({
    brave: () => twoBraveHits,
    musicbrainz: () => musicbrainzArtists([{ id: "mbid-fen", name: "Fen" }, { id: "mbid-ghost", name: "Ghost Bath" }]),
    lastFm: (url) => {
      if (url.includes("artist.getsimilar")) return { similarartists: { artist: [] } };
      const listeners = decodeURIComponent(url).includes("artist=Fen") ? "42000" : "900";
      return { artist: { stats: { listeners } } };
    },
  });
  const events: Array<{ event: string; details: Record<string, unknown> }> = [];

  await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, lastFmApiKey: "lastfm-key", onLog: (_level, event, details) => events.push({ event, details }) }),
    { ...input, obscurityTarget: "cult" },
  );

  const filter = events.find((e) => e.event === "research_obscurity_filter");
  assert.ok(filter, "the filter is logged");
  const twoCandidates = { inRange: 1, tooObscure: 1, tooMainstream: 0 };
  assert.deepEqual(filter.details.fitBefore, twoCandidates);
  assert.deepEqual(filter.details.fitAfter, twoCandidates, "with fewer than five in range, the too-obscure candidate fills the pool");
});

// ------------------------------------------------------------ provenance

test("a research run names the model that wrote its prose", async () => {
  const { client, fetchImpl } = happyPath();

  const result = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, model: "test-model-7b" }),
    input,
  );

  assert.equal(result.model, "test-model-7b");
});

test("a research run without a configured model names the default", async () => {
  const { client, fetchImpl } = happyPath();

  const result = await invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl }), input);

  assert.equal(result.model, "gemini-2.5-flash");
});

// ------------------------------------------------- degraded, not failed (#241)

function timesOut(node: string) {
  return () => {
    throw new Error(`${node} timeout`);
  };
}

test("a planner that times out still yields recommendations from the fallback search plan", async () => {
  const { client, fetchImpl, log } = happyPath({ plan: timesOut("web search planner") });
  const events: Array<{ event: string; details: Record<string, unknown> }> = [];

  const result = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, onLog: (_level, event, details) => events.push({ event, details }) }),
    input,
  );

  assert.equal(result.recommendations.length, 1);
  assert.ok(
    log.some((r) => r.url.includes("api.search.brave.com") && decodeURIComponent(r.url).includes("site:bandcamp.com")),
    "the fallback plan's broad queries were searched",
  );
  const fallback = events.find((e) => e.event === "research_plan_fallback");
  assert.ok(fallback, "the fallback is logged");
  assert.match(String(fallback.details.reason), /web search planner timeout/);
});

test("a reflector that fails skips reflection instead of failing the request", async () => {
  const { client, fetchImpl } = happyPath({ reflect: timesOut("reflector") });
  const events: string[] = [];

  const result = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, targetVerifiedCount: 5, onLog: (_level, event) => events.push(event) }),
    input,
  );

  assert.equal(result.recommendations.length, 1);
  assert.ok(events.includes("research_reflection_skipped"), `got ${events.join(", ")}`);
});

test("a failing extraction in the reflection round keeps the candidates already found", async () => {
  let extractCalls = 0;
  const { client, fetchImpl } = happyPath({
    reflect: () => ({ sufficient: false, gaps: ["more obscure picks"], extraQueries: ["blackgaze demo bandcamp"] }),
    extract: () => {
      extractCalls += 1;
      if (extractCalls > 1) throw new Error("candidate extractor timeout");
      return extractedCandidates([
        { name: "Fen", hits: [1] },
        { name: "Ghost Bath", hits: [2] },
      ]);
    },
  });
  const events: string[] = [];

  const result = await invokeResearchGraph(
    graphDeps({ modelClient: client, fetchImpl, targetVerifiedCount: 5, onLog: (_level, event) => events.push(event) }),
    input,
  );

  assert.ok(extractCalls >= 2, "the reflection round tried to extract");
  assert.equal(result.recommendations.length, 1);
  assert.ok(events.includes("research_reflection_extract_failed"), `got ${events.join(", ")}`);
});

test("a ranker that times out still fails the request: there is no honest fallback for the prose", async () => {
  const { client, fetchImpl } = happyPath({ rank: timesOut("recommendation ranker") });

  await assert.rejects(
    () => invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl }), input),
    /recommendation ranker timeout/,
  );
});

// ------------------------------------------------- provider switch (#237)

test("every research node builds its model from the configured factory, at its own temperature", async () => {
  const { client, fetchImpl } = happyPath();
  const temperatures: number[] = [];

  const result = await invokeResearchGraph(
    graphDeps({
      fetchImpl,
      model: "gemma-4-26b-a4b-it",
      chatModel: ({ temperature }) => {
        temperatures.push(temperature);
        return client;
      },
    }),
    input,
  );

  assert.equal(result.recommendations.length, 1, "the run completes on the factory's model");
  assert.equal(result.model, "gemma-4-26b-a4b-it");
  assert.deepEqual(
    [...new Set(temperatures)].sort(),
    [0.1, 0.15, 0.2, 0.35],
    "planner 0.2, extractor 0.1, reflector 0.15, ranker 0.35",
  );
});
