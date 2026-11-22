import { plainText } from "../agent/research/textSnippets.js";

const LASTFM_API_ENDPOINT = "https://ws.audioscrobbler.com/2.0/";
const DEFAULT_TIMEOUT_MS = 5000;

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

export type LastFmClientConfig = {
  apiKey: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
};

export type SimilarArtist = { name: string; match: number };

/** A listener-applied tag; `count` is Last.fm's relative weight, 100 for the artist's top tag. */
export type LastFmTag = { name: string; count: number };

/** What Last.fm knows about an artist, from one request. */
export type LastFmArtistInfo = {
  listeners: number | null;
  /** The artist's Last.fm page. */
  url: string | null;
  tags: string[];
  /** The start of the biography as plain text; "" without one, or when the page is shared by several artists of that name. */
  biography: string;
};

export type LastFmClient = {
  getListenerCount(artistName: string): Promise<number | null>;
  /** Null when Last.fm could not be asked or lists no such artist. */
  getArtistInfo(artistName: string): Promise<LastFmArtistInfo | null>;
  getSimilarArtists(artistName: string, limit?: number): Promise<SimilarArtist[]>;
  /**
   * Listener tags, by MusicBrainz id when known (exact) or by name. Null when
   * Last.fm could not be asked; [] when the artist has no tags or is unknown.
   */
  getTopTags(artistName: string, mbid?: string): Promise<LastFmTag[] | null>;
};

type LastFmInfoResponse = {
  artist?: {
    url?: string;
    stats?: { listeners?: string };
    tags?: { tag?: Array<{ name?: string }> } | string;
    bio?: { summary?: string };
  };
  error?: number;
};

type LastFmTopTagsResponse = {
  toptags?: { tag?: Array<{ name?: string; count?: number | string }> };
  error?: number;
};

/** Last.fm's "The artist you supplied could not be found". */
const LASTFM_ERROR_NOT_FOUND = 6;

type LastFmSimilarResponse = {
  similarartists?: { artist?: Array<{ name?: string; match?: string }> };
  error?: number;
};

/** Opening words of a page several artists of one name share: whom a sentence is about cannot be told. */
const SHARED_PAGE =
  /^.{0,120}\b(multiple|several|different|various|(more than|at least) (one|two|three|\d+)|two|three|four|five|six|\d+) (known |different )?(artists?|bands?|acts?|groups?|musicians?|projects?)\b|(^|\s)\(?1[.)]\s/i;

function biographyOf(summary: string | undefined): string {
  // Every summary ends in a link to the full page.
  const text = plainText(String(summary ?? "").replace(/<a [^>]*>read more on last\.fm<\/a>.*$/is, ""));
  return SHARED_PAGE.test(text) ? "" : text;
}

export function createLastFmClient(config: LastFmClientConfig): LastFmClient {
  const apiKey = config.apiKey ?? "";
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl: FetchLike = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  /**
   * One Last.fm call. Failures and non-OK answers become `fallback`, since the
   * enrichment is best effort; a cancelled run rejects before any request starts.
   */
  async function request<T>(url: string, fallback: T, parse: (body: unknown) => T): Promise<T> {
    config.signal?.throwIfAborted();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: config.signal ? AbortSignal.any([config.signal, controller.signal]) : controller.signal,
        headers: { "User-Agent": "Bandsearch/1.0 (https://github.com/eikrad/bandsearch-app)" },
      });
      if (!response.ok) return fallback;
      return parse(await response.json());
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getArtistInfo(artistName: string): Promise<LastFmArtistInfo | null> {
    const trimmed = artistName.trim();
    if (!apiKey || !trimmed) {
      return null;
    }

    const url =
      `${LASTFM_API_ENDPOINT}?method=artist.getinfo` +
      `&artist=${encodeURIComponent(trimmed)}` +
      `&api_key=${encodeURIComponent(apiKey)}&format=json`;

    return request(url, null, (raw) => {
      const { artist, error } = raw as LastFmInfoResponse;
      if (error || !artist) return null;
      const listeners = Number(artist.stats?.listeners);
      // Without tags, Last.fm answers "" instead of an object.
      const tags = typeof artist.tags === "object" ? artist.tags?.tag : undefined;
      return {
        listeners: Number.isFinite(listeners) ? listeners : null,
        url: artist.url?.trim() || null,
        tags: (Array.isArray(tags) ? tags : []).flatMap((t) => t.name?.trim() || []),
        biography: biographyOf(artist.bio?.summary),
      };
    });
  }

  return {
    getArtistInfo,

    async getListenerCount(artistName: string): Promise<number | null> {
      return (await getArtistInfo(artistName))?.listeners ?? null;
    },

    async getSimilarArtists(artistName: string, limit = 50): Promise<SimilarArtist[]> {
      const trimmed = artistName.trim();
      if (!apiKey || !trimmed) return [];

      const url =
        `${LASTFM_API_ENDPOINT}?method=artist.getSimilar` +
        `&artist=${encodeURIComponent(trimmed)}` +
        `&limit=${limit}` +
        `&api_key=${encodeURIComponent(apiKey)}&format=json`;

      return request(url, [], (raw) => {
        const body = raw as LastFmSimilarResponse;
        if (body.error) return [];
        return (body.similarartists?.artist ?? [])
          .filter((a) => a.name?.trim())
          .map((a) => ({ name: a.name!.trim(), match: Number(a.match) || 0 }));
      });
    },

    async getTopTags(artistName: string, mbid?: string): Promise<LastFmTag[] | null> {
      const trimmed = artistName.trim();
      if (!apiKey || (!trimmed && !mbid)) return null;

      const lookup = mbid ? `&mbid=${encodeURIComponent(mbid)}` : `&artist=${encodeURIComponent(trimmed)}`;
      const url =
        `${LASTFM_API_ENDPOINT}?method=artist.gettoptags${lookup}` +
        `&autocorrect=1&api_key=${encodeURIComponent(apiKey)}&format=json`;

      return request(url, null, (raw) => {
        const body = raw as LastFmTopTagsResponse;
        if (body.error === LASTFM_ERROR_NOT_FOUND) return [];
        if (body.error) return null;
        return (body.toptags?.tag ?? [])
          .filter((t) => t.name?.trim())
          .map((t) => ({ name: t.name!.trim(), count: Number(t.count) || 0 }));
      });
    },
  };
}
