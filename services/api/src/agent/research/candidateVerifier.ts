import { fitObscurityTarget } from "../../obscurityTargets.js";
import type { ExtractedCandidate } from "./candidateExtractor.js";

export type VerifiedCandidate = {
  name: string;
  evidenceUrls: string[];
  evidenceSnippets: string[];
  sourceQueries: string[];
  mbid?: string;
  verified: boolean;
  canonicalName?: string;
  mbTags?: string[];
  mbGenres?: string[];
  mbUrls?: string[];
  lifeSpan?: { begin?: string; end?: string; ended: boolean };
  listenerCount?: number | null;
};

/** The ranker's pool under an obscurity target: in-range candidates, topped up to this many. */
export const OBSCURITY_POOL_MIN = 5;

/**
 * Narrows the ranker's pool to the requested obscurity target's listener range
 * (#325), with a floor as well as a ceiling. When fewer than OBSCURITY_POOL_MIN
 * candidates are in range, the nearest misses in either direction fill up the
 * pool, in-range first. How a candidate fits, missing counts included, is
 * fitObscurityTarget's rule, which the eval shares; when it has nothing to fit
 * against, the pool passes unchanged.
 */
export function filterCandidatesByObscurity(
  candidates: VerifiedCandidate[],
  obscurityTarget?: string,
): VerifiedCandidate[] {
  const fits = fitObscurityTarget(candidates.map((c) => c.listenerCount), obscurityTarget);
  if (!fits) return candidates;
  const byMiss = candidates
    .map((c, i) => ({ c, miss: fits[i]!.miss }))
    .sort((a, b) => a.miss - b.miss);
  const inRange = fits.filter((f) => f.fit === "inRange").length;
  return byMiss.slice(0, Math.max(inRange, OBSCURITY_POOL_MIN)).map((x) => x.c);
}

export type MusicBrainzVerifyClient = {
  searchArtists: (q: string) => Promise<Array<{ id?: string; name: string; score?: number }>>;
  lookupArtist: (mbid: string) => Promise<{
    id: string;
    name: string;
    tags: string[];
    genres: string[];
    urls: Array<{ type: string; url: string }>;
    lifeSpan: { begin?: string; end?: string; ended: boolean };
  }>;
};

export function mergeVerifiedCandidates(candidates: VerifiedCandidate[]): VerifiedCandidate[] {
  const map = new Map<string, VerifiedCandidate>();
  for (const c of candidates) {
    const key = c.mbid ?? (c.canonicalName ?? c.name).toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...c });
    } else {
      const winner = c.verified && !existing.verified ? c : existing;
      const other = winner === c ? existing : c;
      map.set(key, {
        ...winner,
        evidenceUrls: [...new Set([...winner.evidenceUrls, ...other.evidenceUrls])],
        evidenceSnippets: [...new Set([...winner.evidenceSnippets, ...other.evidenceSnippets])],
        sourceQueries: [...new Set([...winner.sourceQueries, ...other.sourceQueries])],
      });
    }
  }
  return [...map.values()];
}

export function normalizeAnchorSet(anchorArtists: string[]): Set<string> {
  const s = new Set<string>();
  for (const a of anchorArtists) {
    const t = String(a || "").trim().toLowerCase();
    if (t) s.add(t);
  }
  return s;
}

function pickSearchHit(
  hits: Array<{ id?: string; name: string; score?: number }>,
  minSearchScore: number,
): { id?: string; name: string; score?: number } | null {
  if (!Array.isArray(hits) || hits.length === 0) return null;
  const acceptable = hits.find((h) => h.score === undefined || h.score >= minSearchScore);
  return acceptable ?? hits[0];
}

/**
 * Resolve each extracted name against MusicBrainz search + artist lookup.
 */
export async function verifyCandidatesWithMusicBrainz(
  mb: MusicBrainzVerifyClient,
  candidates: ExtractedCandidate[],
  anchorArtists: string[],
  options: { minSearchScore?: number; shouldContinue?: () => boolean } = {},
): Promise<VerifiedCandidate[]> {
  const anchors = normalizeAnchorSet(anchorArtists);
  const minSearchScore = typeof options.minSearchScore === "number" ? options.minSearchScore : 35;

  const out: VerifiedCandidate[] = [];

  for (const c of candidates) {
    if (options.shouldContinue?.() === false) break;
    const nameKey = String(c.name || "").trim().toLowerCase();
    if (!nameKey || anchors.has(nameKey)) continue;

    let hits: Array<{ id?: string; name: string; score?: number }>;
    try {
      hits = await mb.searchArtists(c.name.trim());
    } catch {
      out.push({
        ...c,
        verified: false,
      });
      continue;
    }

    const hit = pickSearchHit(hits, minSearchScore);
    if (!hit?.id) {
      out.push({
        ...c,
        verified: false,
      });
      continue;
    }

    if (options.shouldContinue?.() === false) break;
    try {
      const details = await mb.lookupArtist(hit.id);
      out.push({
        ...c,
        mbid: hit.id,
        verified: true,
        canonicalName: details.name,
        mbTags: details.tags,
        mbGenres: details.genres,
        mbUrls: details.urls.map((u) => u.url),
        lifeSpan: details.lifeSpan,
      });
    } catch {
      out.push({
        ...c,
        mbid: hit.id,
        verified: false,
      });
    }
  }

  return out;
}
