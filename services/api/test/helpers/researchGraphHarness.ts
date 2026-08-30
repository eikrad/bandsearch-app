import type { ChatModelClient } from "../../src/agent/modelUtils.js";
import type { ResearchGraphDeps } from "../../src/agent/research/researchGraph.js";

/**
 * Fakes for everything the research graph reaches out to.
 *
 * The graph builds its own Brave, MusicBrainz and Last.fm clients, but all
 * three already take a `fetchImpl`, and the Gemini-backed nodes now take a
 * `modelClient` — so the whole pipeline can be driven end to end without a key
 * or a network call.
 */

export type ModelCall = { system: string; user: string };

/**
 * A chat model that answers by matching the system prompt.
 *
 * The four Gemini nodes are told apart by a distinctive phrase in their system
 * prompt, which is more robust than counting calls: reflection re-enters the
 * extractor, so call order is not fixed.
 */
export function fakeModelClient(
  responders: {
    plan?: () => unknown;
    extract?: (call: ModelCall) => unknown;
    reflect?: (call: ModelCall) => unknown;
    rank?: () => unknown;
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
          return responders.rank?.() ?? { reply: "", recommendations: [] };
        }
        throw new Error(`unrouted model call in research graph test: ${system.slice(0, 60)}`);
      })();

      return { content: JSON.stringify(body) };
    },
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
  musicbrainzSearch?: (url: string) => unknown;
  musicbrainzLookup?: (url: string) => unknown;
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
      // `/artist?query=` is the search; `/artist/<mbid>` is the lookup.
      if (url.includes("query=")) {
        return json(handlers.musicbrainzSearch?.(url) ?? { artists: [] });
      }
      return json(handlers.musicbrainzLookup?.(url) ?? { id: "", name: "", tags: [], genres: [], relations: [] });
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

/** MusicBrainz search hit list. */
export function musicbrainzArtists(artists: Array<{ id: string; name: string; score?: number }>) {
  return { artists: artists.map((a) => ({ score: 100, ...a })) };
}

/** MusicBrainz artist lookup record. */
export function musicbrainzArtist(overrides: Record<string, unknown> = {}) {
  return {
    id: "mbid-1",
    name: "Fen",
    tags: [{ name: "blackgaze", count: 3 }],
    genres: [{ name: "post-black metal" }],
    relations: [],
    "life-span": { begin: "2006", ended: false },
    ...overrides,
  };
}

/** The extractor's output shape. */
export function extractedCandidates(
  names: Array<{ name: string; evidenceUrls?: string[]; evidenceSnippets?: string[]; sourceQueries?: string[] }>,
) {
  return {
    candidates: names.map((c) => ({
      evidenceUrls: [],
      evidenceSnippets: [],
      sourceQueries: [],
      ...c,
    })),
  };
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
    geminiApiKey: "",
    braveApiKey: "test-brave-key",
    maxInitialSearches: 2,
    maxReflectionSearches: 2,
    totalSearchBudget: 6,
    targetVerifiedCount: 2,
    researchTimeoutMs: 60_000,
    ...overrides,
  };
}
