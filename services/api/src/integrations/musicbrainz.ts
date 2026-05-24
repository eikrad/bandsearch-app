/* eslint-disable @typescript-eslint/no-explicit-any */
const DEFAULT_BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = "bandsearch-app/0.1.0 (https://github.com/eikrad/bandsearch-app)";

async function fetchWithTimeoutAndRetry({
  fetchImpl,
  url,
  timeoutMs,
  retries,
  headers,
}: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  retries: number;
  headers: Record<string, string>;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
    }
  }
  throw lastError;
}

export function createMusicBrainzClient({
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 5000,
  retries = 1,
}: {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
} = {}) {
  return {
    async searchArtists(query: string) {
      const encodedQuery = encodeURIComponent(query);
      const url = `${baseUrl}/artist?query=${encodedQuery}&fmt=json&limit=5`;
      const response = await fetchWithTimeoutAndRetry({
        fetchImpl,
        url,
        timeoutMs,
        retries,
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`musicbrainz request failed with status ${response.status}`);
      }

      const data: any = await response.json();
      const artists = Array.isArray(data.artists) ? data.artists : [];
      return artists.map((artist: any) => ({
        id: artist.id,
        name: artist.name,
        score: artist.score,
        disambiguation: artist.disambiguation || "",
      }));
    },

    async lookupArtist(mbid: string) {
      const id = String(mbid ?? "").trim();
      if (!id) {
        throw new Error("mbid is required for lookupArtist");
      }
      const encoded = encodeURIComponent(id);
      const url = `${baseUrl}/artist/${encoded}?fmt=json&inc=tags+genres+url-rels`;
      const response = await fetchWithTimeoutAndRetry({
        fetchImpl,
        url,
        timeoutMs,
        retries,
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`musicbrainz request failed with status ${response.status}`);
      }

      const data: any = await response.json();

      const tags = Array.isArray(data.tags)
        ? data.tags.map((t: any) => (t && typeof t.name === "string" ? t.name : "")).filter(Boolean)
        : [];
      const genres = Array.isArray(data.genres)
        ? data.genres.map((g: any) => (g && typeof g.name === "string" ? g.name : "")).filter(Boolean)
        : [];

      const urls: { type: string; url: string }[] = [];
      const relations = Array.isArray(data.relations) ? data.relations : [];
      for (const rel of relations) {
        if (!rel || typeof rel !== "object") continue;
        const type = typeof rel.type === "string" ? rel.type : "";
        const urlObj = rel.url && typeof rel.url === "object" ? rel.url : null;
        const resource = urlObj && typeof urlObj.resource === "string" ? urlObj.resource : "";
        if (resource) {
          urls.push({ type: type || "url", url: resource });
        }
      }

      const lifeSpanRaw = data["life-span"];
      let lifeSpan: { begin?: string; end?: string; ended: boolean } = { begin: undefined, end: undefined, ended: false };
      if (lifeSpanRaw && typeof lifeSpanRaw === "object" && !Array.isArray(lifeSpanRaw)) {
        const ls = lifeSpanRaw as { begin?: string; end?: string; ended?: boolean };
        lifeSpan = {
          begin: typeof ls.begin === "string" ? ls.begin : undefined,
          end: typeof ls.end === "string" ? ls.end : undefined,
          ended: Boolean(ls.ended),
        };
      }

      return {
        id: typeof data.id === "string" ? data.id : id,
        name: typeof data.name === "string" ? data.name : "",
        tags,
        genres,
        urls,
        lifeSpan,
      };
    },
  };
}
