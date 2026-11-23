import type { ChatModelClient } from "../../src/agent/modelUtils.js";
import type { ResearchGraphDeps } from "../../src/agent/research/researchGraph.js";

/**
 * Fakes for everything the research graph reaches out to.
 *
 * The graph builds its own Brave, MusicBrainz and Last.fm clients, but all
 * three already take a `fetchImpl`, and the model-backed nodes take a
 * `modelClient` — so the whole pipeline can be driven end to end without a key
 * or a network call.
 */

export type ModelCall = { system: string; user: string };

/**
 * A chat model that answers by matching the system prompt.
 *
 * The four model-backed nodes are told apart by a distinctive phrase in their system
 * prompt, which is more robust than counting calls: reflection re-enters the
 * extractor, so call order is not fixed.
 */
export function fakeModelClient(
  responders: {
    plan?: () => unknown;
    extract?: (call: ModelCall) => unknown;
    reflect?: (call: ModelCall) => unknown;
    rank?: (call: ModelCall) => unknown;
    route?: (call: ModelCall) => unknown;
    /** An answer in words, not JSON. */
    answer?: (call: ModelCall) => string;
  } = {},
): { client: ChatModelClient; calls: ModelCall[] } {
  const calls: ModelCall[] = [];

  const client: ChatModelClient = {
    async invoke(prompt) {
      const system = prompt.find((p) => p.role === "system")?.content ?? "";
      const user = prompt.filter((p) => p.role === "user").map((p) => p.content).join("\n");
      const call = { system, user };
      calls.push(call);

      const body = (() => {
        // Each node's system prompt opens with a distinct sentence; matching on
        // those is stabler than call order, since reflection re-enters the
        // extractor partway through a run.
        if (system.startsWith("You plan Brave web searches")) {
          return responders.plan?.() ?? {
            anchorArtists: ["Alcest"],
            styleSignals: [],
            mustHave: [],
            avoid: [],
            queries: ["ffo alcest blackgaze"],
          };
        }
        if (system.startsWith("You evaluate whether web search found enough")) {
          return responders.reflect?.(call) ?? { sufficient: true, gaps: [], extraQueries: [] };
        }
        if (system.startsWith("You extract band or artist names")) {
          return responders.extract?.(call) ?? { candidates: [] };
        }
        if (system.startsWith("You recommend niche bands")) {
          return responders.rank?.(call) ?? { reply: "", recommendations: [] };
        }
        if (system.startsWith("You decide how a music discovery chat")) {
          return responders.route?.(call) ?? { action: "search" };
        }
        if (system.startsWith("You are the conversational side")) {
          return responders.answer?.(call) ?? "Glad you like them.";
        }
        throw new Error(`unrouted model call in research graph test: ${system.slice(0, 60)}`);
      })();

      return { content: typeof body === "string" ? body : JSON.stringify(body) };
    },
  };

  // Streams the same answers in two pieces, to callers that listen.
  client.stream = async (prompt, options) => {
    const text = String((await client.invoke(prompt, options)).content);
    const half = Math.ceil(text.length / 2);
    return (async function* () {
      yield { content: text.slice(0, half) };
      yield { content: text.slice(half) };
    })();
  };

  return { client, calls };
}

export type FetchLog = { url: string }[];

/**
 * Routes by hostname to the three upstreams the graph talks to.
 *
 * Anything unrouted throws rather than falling through to a default, so a test
 * that accidentally reaches a real endpoint fails loudly.
 */
export function fakeFetch(handlers: {
  brave?: (url: string) => unknown;
  musicbrainz?: (url: string) => unknown;
  lastFm?: (url: string) => unknown;
}): { fetchImpl: typeof fetch; log: FetchLog } {
  const log: FetchLog = [];

  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    log.push({ url });

    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (url.includes("api.search.brave.com")) {
      return json(handlers.brave?.(url) ?? { web: { results: [] } });
    }
    if (url.includes("musicbrainz.org")) {
      return json(handlers.musicbrainz?.(url) ?? { artists: [] });
    }
    if (url.includes("audioscrobbler.com")) {
      return json(handlers.lastFm?.(url) ?? {});
    }

    throw new Error(`unrouted fetch in research graph test: ${url}`);
  }) as unknown as typeof fetch;

  return { fetchImpl, log };
}

/** Brave's shape: one result block per hit. */
export function braveResults(hits: Array<{ title: string; url: string; description: string }>) {
  return { web: { results: hits } };
}

/** MusicBrainz answer to a search for several artist names. */
export function musicbrainzArtists(artists: Array<{ id: string; name: string; score?: number }>) {
  return { artists: artists.map((a) => ({ score: 100, ...a })) };
}

/** The extractor's output: each band with the numbers of the hits it appears in (the first by default). */
export function extractedCandidates(candidates: Array<{ name: string; hits?: number[] }>) {
  return { candidates: candidates.map((c) => ({ hits: [1], ...c })) };
}

/** A ranker payload the recommendation contract accepts. */
export function rankedRecommendations(
  items: Array<{ artist: string; why: string; sourceSignals?: string[]; musicbrainzArtistId?: string }>,
  reply = "Here are some picks.",
) {
  return {
    reply,
    recommendations: items.map((i) => ({ sourceSignals: [], ...i })),
  };
}

/** Graph deps with everything faked and the budgets small enough to stay fast. */
export function graphDeps(overrides: Partial<ResearchGraphDeps> = {}): ResearchGraphDeps {
  return {
    braveApiKey: "test-brave-key",
    model: "test-research-model",
    maxInitialSearches: 2,
    maxReflectionSearches: 2,
    totalSearchBudget: 6,
    targetVerifiedCount: 2,
    researchTimeoutMs: 60_000,
    braveMinIntervalMs: 0,
    ...overrides,
  };
}
