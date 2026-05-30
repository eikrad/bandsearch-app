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

export type LastFmClient = {
  getListenerCount(artistName: string): Promise<number | null>;
};

type LastFmInfoResponse = {
  artist?: { stats?: { listeners?: string } };
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
  };
}
