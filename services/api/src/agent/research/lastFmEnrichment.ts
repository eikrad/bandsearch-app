import type { LastFmArtistInfo, LastFmClient, SimilarArtist } from "../../eval/lastFmClient.js";
import { errorMessage } from "../modelUtils.js";
import type { ExtractedCandidate } from "./candidateExtractor.js";
import type { VerifiedCandidate } from "./candidateVerifier.js";
import { artistKey, type ResearchCache } from "./researchCache.js";
import type { ResearchBudget } from "./researchBudget.js";
import { wordsAround } from "./textSnippets.js";

const BIOGRAPHY_MAX_CHARS = 260;

/** Bands taken from the similar-artist lists. */
const MAX_SIMILAR_CANDIDATES = 40;
/** Marks where a candidate was found, beside the web searches' queries. */
const SIMILAR_SOURCE = "last.fm similar to ";

/** Whether a web search named the candidate, not only Last.fm's similar-artist lists. */
export function foundOnTheWeb(candidate: Pick<ExtractedCandidate, "sourceQueries">): boolean {
  return candidate.sourceQueries.some((query) => !query.startsWith(SIMILAR_SOURCE));
}

/** How long a finished research round waits for Last.fm answers still under way. */
const LASTFM_WAIT_MS = 5000;
/** Similar artists usually answer within a second. */
const SIMILAR_WAIT_MS = 2500;

type Lookup<T> = { promise: Promise<unknown>; value: T | undefined };

export type LastFmEnrichment = {
  /** Starts asking for the anchors' similar artists, without waiting. */
  prefetchSimilar(anchorArtists: string[]): void;
  /** Starts asking for the bands' listener counts and biographies, without waiting. */
  prefetchInfo(names: string[]): void;
  /**
   * Bands Last.fm's listeners file next to the anchors, closest first: a
   * candidate source of its own. Waits briefly for answers under way.
   */
  similarCandidates(anchorArtists: string[]): Promise<ExtractedCandidate[]>;
  /** The candidates with what Last.fm knows about them, as far as it answered in time. */
  enrich(candidates: VerifiedCandidate[], anchorArtists: string[]): Promise<VerifiedCandidate[]>;
};

/**
 * Last.fm facts of one search. Lookups start as soon as a name is known and run
 * alongside the other stages; what has not been answered when the candidates
 * are ready is left out, never the answers that did arrive.
 */
export function createLastFmEnrichment({
  clientFor,
  budget,
  cache,
  log,
}: {
  /** A client whose requests stop with the signal. */
  clientFor: (signal: AbortSignal) => LastFmClient;
  budget: ResearchBudget;
  cache?: Pick<ResearchCache, "artistInfo" | "similarArtists">;
  log: (level: "info" | "warn", event: string, details: Record<string, unknown>) => void;
}): LastFmEnrichment {
  const infos = new Map<string, Lookup<LastFmArtistInfo | null>>();
  const similar = new Map<string, Lookup<SimilarArtist[]>>();

  function start<T>(lookups: Map<string, Lookup<T>>, name: string, ask: (client: LastFmClient) => Promise<T>, remembered?: T): Lookup<T> {
    const key = artistKey(name);
    const running = lookups.get(key);
    if (running) return running;
    const lookup: Lookup<T> = { promise: Promise.resolve(), value: remembered };
    lookups.set(key, lookup);
    if (remembered === undefined && budget.remaining() > 0) {
      lookup.promise = budget
        .run(budget.remaining(), (signal) => ask(clientFor(signal)))
        .then((value) => { lookup.value = value; }, () => undefined);
    }
    return lookup;
  }

  const infoOf = (name: string) =>
    start(infos, name, async (client) => {
      const info = await client.getArtistInfo(name);
      if (info) cache?.artistInfo.set(artistKey(name), info);
      return info;
    }, cache?.artistInfo.get(artistKey(name)));

  const similarTo = (anchor: string) =>
    start(similar, anchor, async (client) => {
      const artists = await client.getSimilarArtists(anchor);
      if (artists.length > 0) cache?.similarArtists.set(artistKey(anchor), artists);
      return artists;
    }, cache?.similarArtists.get(artistKey(anchor)));

  const similarUrl = (anchor: string) => `https://www.last.fm/music/${encodeURIComponent(anchor)}/+similar`;
  const similarSnippet = (anchor: string, match: number) => `Similar to ${anchor} on last.fm (match: ${match.toFixed(2)})`;

  /** Waits for the lookups, at most `ms`; what has not been answered then is left out. */
  async function settle(pending: Array<Lookup<unknown>>, ms: number) {
    if (budget.remaining() <= 0) return;
    await budget.run(ms, () => Promise.all(pending.map((l) => l.promise))).catch((error: unknown) => {
      log("warn", "research_lastfm_incomplete", { reason: errorMessage(error) });
    });
  }

  return {
    prefetchSimilar(anchorArtists) {
      for (const anchor of anchorArtists) similarTo(anchor);
    },

    prefetchInfo(names) {
      for (const name of names) infoOf(name);
    },

    async similarCandidates(anchorArtists) {
      const anchors = anchorArtists.map((anchor) => ({ anchor, lookup: similarTo(anchor) }));
      await settle(anchors.map((a) => a.lookup), SIMILAR_WAIT_MS);
      const isAnchor = new Set(anchorArtists.map(artistKey));
      const found = new Map<string, { name: string; total: number; best: { anchor: string; match: number } }>();
      for (const { anchor, lookup } of anchors) {
        for (const { name, match } of lookup.value ?? []) {
          const key = artistKey(name);
          if (isAnchor.has(key)) continue;
          const known = found.get(key);
          if (!known) found.set(key, { name, total: match, best: { anchor, match } });
          else {
            known.total += match;
            if (match > known.best.match) known.best = { anchor, match };
          }
        }
      }
      return [...found.values()]
        .sort((a, b) => b.total - a.total)
        .slice(0, MAX_SIMILAR_CANDIDATES)
        .map(({ name, best }) => ({
          name,
          evidenceUrls: [similarUrl(best.anchor)],
          evidenceSnippets: [similarSnippet(best.anchor, best.match)],
          sourceQueries: [`${SIMILAR_SOURCE}${best.anchor}`],
        }));
    },

    async enrich(candidates, anchorArtists) {
      if (candidates.length === 0) return candidates;
      const anchors = anchorArtists.map((anchor) => ({ anchor, lookup: similarTo(anchor) }));
      // Last.fm lists an artist under its MusicBrainz name; the spelling it was found under is the fallback.
      const lookups = candidates.map((c) => [...new Set([c.canonicalName || c.name, c.name])].map(infoOf));
      const pending = [...anchors.map((a) => a.lookup), ...lookups.flat()];

      await settle(pending, LASTFM_WAIT_MS);

      const similarMap = new Map<string, { anchor: string; match: number }>();
      for (const { anchor, lookup } of anchors) {
        for (const s of lookup.value ?? []) {
          const key = artistKey(s.name);
          const existing = similarMap.get(key);
          if (!existing || s.match > existing.match) similarMap.set(key, { anchor, match: s.match });
        }
      }

      let matchCount = 0;
      const enriched = candidates.map((c, i): VerifiedCandidate => {
        const known = lookups[i]!.map((l) => l.value).filter((info) => info != null);
        const info = known.find((k) => k.listeners !== null) ?? known[0];
        const hit = similarMap.get(artistKey(c.canonicalName || c.name)) ?? similarMap.get(artistKey(c.name));
        if (hit) matchCount++;
        // The biography says most about the band itself, so it comes before the similarity.
        const urls = [info?.biography && info.url, hit && similarUrl(hit.anchor)].filter((u): u is string => Boolean(u));
        const snippets = [
          info?.biography && `On last.fm: ${wordsAround(info.biography, 0, 0, BIOGRAPHY_MAX_CHARS)}`,
          hit && similarSnippet(hit.anchor, hit.match),
        ].filter((text): text is string => Boolean(text));
        return {
          ...c,
          listenerCount: info?.listeners ?? null,
          ...(info?.tags.length ? { listenerTags: info.tags } : {}),
          evidenceUrls: [...new Set([...c.evidenceUrls, ...urls])],
          evidenceSnippets: [...new Set([...c.evidenceSnippets, ...snippets])],
        };
      });

      log("info", "research_lastfm_enrichment", {
        anchorCount: anchorArtists.length,
        candidateCount: candidates.length,
        matchCount,
        listenersFetched: enriched.filter((c) => c.listenerCount != null).length,
        unanswered: pending.filter((l) => l.value === undefined).length,
      });
      return enriched;
    },
  };
}
