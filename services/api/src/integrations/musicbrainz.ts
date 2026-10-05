import { fetchWithTimeoutAndRetry } from "./httpClient.js";

const DEFAULT_BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = "bandsearch-app/0.1.0 (https://github.com/eikrad/bandsearch-app)";
/** MusicBrainz IP rule: average above 1 req/s → all requests 503 until the rate drops. */
const DEFAULT_MIN_INTERVAL_MS = 1100;

type MusicBrainzSearchResponse = {
  artists?: Array<{
    id?: string;
    name?: string;
    score?: number;
    disambiguation?: string;
  }>;
};

type MusicBrainzArtistResponse = {
  id?: string;
  name?: string;
  /** ISO 3166-1 code, set when the artist's area is a country. */
  country?: string | null;
  area?: { "iso-3166-1-codes"?: string[]; "iso-3166-2-codes"?: string[] } | null;
  tags?: Array<{ name?: string }>;
  genres?: Array<{ name?: string }>;
  relations?: Array<{
    type?: string;
    direction?: string;
    url?: { resource?: string };
    artist?: { id?: string };
  }>;
  "life-span"?: {
    begin?: string;
    end?: string;
    ended?: boolean;
  };
};

/**
 * The artist's country as an ISO 3166-1 code: MusicBrainz's `country` when the
 * area is a country, else the country part of a city area's ISO 3166-2 code
 * ("IS-1" → "IS"). Null when no area is recorded.
 */
function countryOf(data: MusicBrainzArtistResponse): string | null {
  if (typeof data.country === "string" && data.country) return data.country;
  const area = data.area;
  const national = area?.["iso-3166-1-codes"]?.[0];
  if (national) return national;
  const regional = area?.["iso-3166-2-codes"]?.[0];
  return regional ? regional.split("-")[0]! : null;
}

/**
 * Process-wide gate so every MusicBrainz client in this process (API routes,
 * research graph, eval tag lookups) shares the same 1 req/s budget. Per-client
 * queues would still let two instances fire ~2/s and trip the IP ban.
 */
let sharedChain: Promise<unknown> = Promise.resolve();
let sharedLastStart = 0;

function scheduleMusicBrainzRequest<T>(minIntervalMs: number, fn: () => Promise<T>): Promise<T> {
  if (minIntervalMs <= 0) return fn();
  const run = sharedChain.then(async () => {
    const wait = sharedLastStart + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    sharedLastStart = Date.now();
    return fn();
  });
  sharedChain = run.catch(() => undefined);
  return run as Promise<T>;
}

export function createMusicBrainzClient({
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 5000,
  retries = 1,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
}: {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  /** Floor between request starts. `0` disables (tests / stubs). Default 1100. */
  minIntervalMs?: number;
} = {}) {
  const request = <T>(fn: () => Promise<T>): Promise<T> =>
    scheduleMusicBrainzRequest(minIntervalMs, fn);

  return {
    async searchArtists(query: string) {
      return request(async () => {
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

        const data = (await response.json()) as MusicBrainzSearchResponse;
        const artists = Array.isArray(data.artists) ? data.artists : [];
        return artists.map((artist) => ({
          id: artist.id ?? "",
          name: artist.name ?? "",
          score: artist.score ?? 0,
          disambiguation: artist.disambiguation ?? "",
        }));
      });
    },

    async lookupArtist(mbid: string) {
      const id = String(mbid ?? "").trim();
      if (!id) {
        throw new Error("mbid is required for lookupArtist");
      }
      return request(async () => {
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

        const data = (await response.json()) as MusicBrainzArtistResponse;

        const tags = Array.isArray(data.tags)
          ? data.tags.map((t) => (t && typeof t.name === "string" ? t.name : "")).filter(Boolean)
          : [];
        const genres = Array.isArray(data.genres)
          ? data.genres.map((g) => (g && typeof g.name === "string" ? g.name : "")).filter(Boolean)
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
        let lifeSpan: { begin?: string; end?: string; ended: boolean } = {
          begin: undefined,
          end: undefined,
          ended: false,
        };
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
          country: countryOf(data),
        };
      });
    },

    /**
     * MusicBrainz ids of the people recorded as members of a band (past and
     * present). A separate request with inc=artist-rels, so the pipeline's
     * lookupArtist URL — and the eval replay recordings keyed on it — stay as
     * they are.
     */
    async lookupBandMembers(mbid: string): Promise<string[]> {
      const id = String(mbid ?? "").trim();
      if (!id) throw new Error("mbid is required for lookupBandMembers");
      return request(async () => {
        const url = `${baseUrl}/artist/${encodeURIComponent(id)}?fmt=json&inc=artist-rels`;
        const response = await fetchWithTimeoutAndRetry({
          fetchImpl,
          url,
          timeoutMs,
          retries,
          headers: { "user-agent": USER_AGENT, accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`musicbrainz request failed with status ${response.status}`);
        }
        const data = (await response.json()) as MusicBrainzArtistResponse;
        return (Array.isArray(data.relations) ? data.relations : [])
          .filter((rel) => rel?.type === "member of band" && rel.direction === "backward")
          .map((rel) => rel.artist?.id)
          .filter((memberId): memberId is string => typeof memberId === "string" && memberId !== "");
      });
    },
  };
}
