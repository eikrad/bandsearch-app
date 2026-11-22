import { fitObscurityTarget, isNearTarget } from "../../obscurityTargets.js";
import type { MusicBrainzArtistRecord } from "../../integrations/musicbrainz.js";
import { findArtistNamed } from "./artistNames.js";
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
  lifeSpan?: { begin?: string; end?: string; ended: boolean };
  listenerCount?: number | null;
};

/** The ranker's pool under an obscurity target: in range or near it, topped up to this many. */
export const OBSCURITY_POOL_MIN = 5;

/**
 * Narrows the ranker's pool to the requested obscurity target (#325), with a
 * floor as well as a ceiling. Far misses are dropped in both directions; near
 * misses stay behind the in-range candidates, because the filter cannot see a
 * query's hard constraints and the ranker can. When fewer than
 * OBSCURITY_POOL_MIN candidates are left, the nearest far misses fill up the
 * pool. How a candidate fits, missing counts included, is fitObscurityTarget's
 * rule, which the eval shares; when it has nothing to fit against, the pool
 * passes unchanged.
 */
export function filterCandidatesByObscurity(
  candidates: VerifiedCandidate[],
  obscurityTarget?: string,
): VerifiedCandidate[] {
  const fits = fitObscurityTarget(candidates.map((c) => c.listenerCount), obscurityTarget);
  if (!fits) return candidates;
  const byMiss = candidates
    .map((c, i) => ({ c, fit: fits[i]! }))
    .sort((a, b) => a.fit.miss - b.fit.miss);
  const near = fits.filter(isNearTarget).length;
  return byMiss.slice(0, Math.max(near, OBSCURITY_POOL_MIN)).map((x) => x.c);
}

export type MusicBrainzVerifyClient = {
  findArtistsByName: (names: string[], options?: { includeAliases?: boolean }) => Promise<MusicBrainzArtistRecord[]>;
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

/** Names per MusicBrainz request; more would push matches off its 100-artist result page. */
const VERIFY_BATCH_SIZE = 25;

/**
 * Confirms extracted names against MusicBrainz in batches: one request for all
 * names, then one more for those it missed, aliases included. MusicBrainz
 * allows one request a second, so looking up each name on its own took two
 * thirds of a search.
 */
export async function verifyCandidatesWithMusicBrainz(
  mb: MusicBrainzVerifyClient,
  candidates: ExtractedCandidate[],
  anchorArtists: string[],
  options: { shouldContinue?: () => boolean } = {},
): Promise<VerifiedCandidate[]> {
  const anchors = normalizeAnchorSet(anchorArtists);
  const wanted = candidates.filter((c) => {
    const key = String(c.name || "").trim().toLowerCase();
    return key !== "" && !anchors.has(key);
  });
  const found = new Map<string, MusicBrainzArtistRecord>();

  for (const includeAliases of [false, true]) {
    const missing = [...new Set(wanted.map((c) => c.name.trim()))].filter((name) => !found.has(name));
    for (let i = 0; i < missing.length; i += VERIFY_BATCH_SIZE) {
      if (options.shouldContinue?.() === false) break;
      const names = missing.slice(i, i + VERIFY_BATCH_SIZE);
      try {
        const artists = await mb.findArtistsByName(names, { includeAliases });
        for (const name of names) {
          const artist = findArtistNamed(name, artists);
          if (artist) found.set(name, artist);
        }
      } catch {
        // These names stay unverified; the ones already found are kept.
      }
    }
  }

  return wanted.map((c) => {
    const artist = found.get(c.name.trim());
    if (!artist) return { ...c, verified: false };
    return {
      ...c,
      mbid: artist.id,
      verified: true,
      canonicalName: artist.name,
      mbTags: artist.tags,
      lifeSpan: artist.lifeSpan,
    };
  });
}
