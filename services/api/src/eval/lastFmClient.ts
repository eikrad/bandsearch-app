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

      return request(url, null, (raw) => {
        const body = raw as LastFmInfoResponse;
        if (body.error) return null;
        const listeners = Number(body.artist?.stats?.listeners);
        return Number.isFinite(listeners) ? listeners : null;
      });
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
