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

const OBSCURITY_THRESHOLDS: Record<string, number> = {
  cult: 500_000,
  underground: 50_000,
  obscure: 5_000,
};

const OBSCURITY_FILTER_MIN = 1;

export function filterCandidatesByObscurity(
  candidates: VerifiedCandidate[],
  obscurityTarget?: string,
): VerifiedCandidate[] {
  if (!obscurityTarget || !(obscurityTarget in OBSCURITY_THRESHOLDS)) return candidates;
  const threshold = OBSCURITY_THRESHOLDS[obscurityTarget];
  const filtered = candidates.filter(
    (c) => c.listenerCount == null || c.listenerCount <= threshold,
  );
  return filtered.length >= OBSCURITY_FILTER_MIN ? filtered : candidates;
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
  options: { minSearchScore?: number } = {},
): Promise<VerifiedCandidate[]> {
  const anchors = normalizeAnchorSet(anchorArtists);
  const minSearchScore = typeof options.minSearchScore === "number" ? options.minSearchScore : 35;

  const out: VerifiedCandidate[] = [];

  for (const c of candidates) {
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
