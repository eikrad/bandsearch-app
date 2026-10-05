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
  fetchImpl?: FetchLike;
};

export type SimilarArtist = { name: string; match: number };

/** A listener-applied tag; `count` is Last.fm's relative weight, 100 for the artist's top tag. */
export type LastFmTag = { name: string; count: number };

export type LastFmClient = {
  getListenerCount(artistName: string): Promise<number | null>;
  getSimilarArtists(artistName: string, limit?: number): Promise<SimilarArtist[]>;
  /**
   * Listener tags, by MusicBrainz id when known (exact) or by name. Null when
   * Last.fm could not be asked; [] when the artist has no tags or is unknown.
   */
  getTopTags(artistName: string, mbid?: string): Promise<LastFmTag[] | null>;
};

type LastFmInfoResponse = {
  artist?: { stats?: { listeners?: string } };
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

export function createLastFmClient(config: LastFmClientConfig): LastFmClient {
  const apiKey = config.apiKey ?? "";
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl: FetchLike = config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  return {
    async getListenerCount(artistName: string): Promise<number | null> {
      const trimmed = artistName.trim();
      if (!apiKey || !trimmed) {
        return null;
      }

      const url =
        `${LASTFM_API_ENDPOINT}?method=artist.getinfo` +
        `&artist=${encodeURIComponent(trimmed)}` +
        `&api_key=${encodeURIComponent(apiKey)}&format=json`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Bandsearch/1.0 (https://github.com/eikrad/bandsearch-app)" },
        });
        if (!response.ok) {
          return null;
        }
        const body = (await response.json()) as LastFmInfoResponse;
        if (body.error) {
          return null;
        }
        const raw = body.artist?.stats?.listeners;
        const listeners = Number(raw);
        return Number.isFinite(listeners) ? listeners : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },

    async getSimilarArtists(artistName: string, limit = 50): Promise<SimilarArtist[]> {
      const trimmed = artistName.trim();
      if (!apiKey || !trimmed) return [];

      const url =
        `${LASTFM_API_ENDPOINT}?method=artist.getSimilar` +
        `&artist=${encodeURIComponent(trimmed)}` +
        `&limit=${limit}` +
        `&api_key=${encodeURIComponent(apiKey)}&format=json`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Bandsearch/1.0 (https://github.com/eikrad/bandsearch-app)" },
        });
        if (!response.ok) return [];
        const body = (await response.json()) as LastFmSimilarResponse;
        if (body.error) return [];
        const raw = body.similarartists?.artist ?? [];
        return raw
          .filter((a) => a.name?.trim())
          .map((a) => ({ name: a.name!.trim(), match: Number(a.match) || 0 }));
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    },

    async getTopTags(artistName: string, mbid?: string): Promise<LastFmTag[] | null> {
      const trimmed = artistName.trim();
      if (!apiKey || (!trimmed && !mbid)) return null;

      const lookup = mbid ? `&mbid=${encodeURIComponent(mbid)}` : `&artist=${encodeURIComponent(trimmed)}`;
      const url =
        `${LASTFM_API_ENDPOINT}?method=artist.gettoptags${lookup}` +
        `&autocorrect=1&api_key=${encodeURIComponent(apiKey)}&format=json`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Bandsearch/1.0 (https://github.com/eikrad/bandsearch-app)" },
        });
        if (!response.ok) return null;
        const body = (await response.json()) as LastFmTopTagsResponse;
        if (body.error === LASTFM_ERROR_NOT_FOUND) return [];
        if (body.error) return null;
        return (body.toptags?.tag ?? [])
          .filter((t) => t.name?.trim())
          .map((t) => ({ name: t.name!.trim(), count: Number(t.count) || 0 }));
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
