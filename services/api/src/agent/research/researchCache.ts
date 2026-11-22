import type { SimilarArtist } from "../../eval/lastFmClient.js";
import type { MusicBrainzArtistRecord } from "../../integrations/musicbrainz.js";
import { createTtlCache, type TtlCache } from "../../integrations/ttlCache.js";

/**
 * Artist facts remembered across searches of one process, by artist name.
 * Searches of one chat, or of one taste, meet the same bands again and again.
 * Holds public artist data only, nothing about who searched.
 */
export type ResearchCache = {
  /** The MusicBrainz artist a name refers to; null when MusicBrainz knows none. */
  artists: TtlCache<MusicBrainzArtistRecord | null>;
  listeners: TtlCache<number>;
  similarArtists: TtlCache<SimilarArtist[]>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function createResearchCache(): ResearchCache {
  return {
    artists: createTtlCache({ ttlMs: DAY_MS, maxEntries: 5000 }),
    listeners: createTtlCache({ ttlMs: DAY_MS, maxEntries: 5000 }),
    similarArtists: createTtlCache({ ttlMs: DAY_MS, maxEntries: 500 }),
  };
}

/** One key per spelling: the cache must not decide which spellings are the same artist. */
export function artistKey(name: string): string {
  return name.trim().toLowerCase();
}
