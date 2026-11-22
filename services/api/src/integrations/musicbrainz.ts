import { fetchWithTimeoutAndRetry } from "./httpClient.js";
import { createRateGate } from "./rateGate.js";

const DEFAULT_BASE_URL = "https://musicbrainz.org/ws/2";
const USER_AGENT = "bandsearch-app/0.1.0 (https://github.com/eikrad/bandsearch-app)";
/** MusicBrainz IP rule: average above 1 req/s → all requests 503 until the rate drops. */
const DEFAULT_MIN_INTERVAL_MS = 1100;
/**
 * MusicBrainz answers 503 (Retry-After: 1) whenever its servers are busy, even
 * within our own rate; about 4 in 10 requests on 2026-11-22. Each retry waits
 * for its own slot in the rate gate.
 */
const BUSY_RETRIES = 4;
/** For the aliases few names need, waiting out a busy server is not worth the user's time. */
const BUSY_RETRIES_ALIASES = 1;

type MusicBrainzSearchResponse = {
  artists?: Array<{
    id?: string;
    name?: string;
    score?: number;
    disambiguation?: string;
    aliases?: Array<{ name?: string }> | null;
    tags?: Array<{ name?: string }> | null;
    "life-span"?: LifeSpanResponse | null;
  }>;
};

type LifeSpanResponse = { begin?: string | null; end?: string | null; ended?: boolean | null };

export type MusicBrainzLifeSpan = { begin?: string; end?: string; ended: boolean };

/** One artist of a search by name, with the facts verification needs. */
export type MusicBrainzArtistRecord = {
  id: string;
  name: string;
  /** Search relevance, 0–100. */
  score: number;
  aliases: string[];
  tags: string[];
  lifeSpan: MusicBrainzLifeSpan;
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
  "life-span"?: LifeSpanResponse | null;
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

function namesOf(items: Array<{ name?: string }> | null | undefined): string[] {
  return (Array.isArray(items) ? items : []).map((t) => (t && typeof t.name === "string" ? t.name : "")).filter(Boolean);
}

function lifeSpanOf(raw: LifeSpanResponse | null | undefined): MusicBrainzLifeSpan {
  const span = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    begin: typeof span.begin === "string" ? span.begin : undefined,
    end: typeof span.end === "string" ? span.end : undefined,
    ended: Boolean(span.ended),
  };
}

/** A quoted phrase for MusicBrainz's search, with quotes and backslashes escaped. */
function searchPhrase(text: string): string {
  return `"${text.trim().replace(/[\\"]/g, "\\$&")}"`;
}

/** Every MusicBrainz client in this process (API routes, research graph, eval lookups) shares one budget. */
const sharedGate = createRateGate();

export function createMusicBrainzClient({
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 5000,
  retries = 1,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  signal,
}: {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  /** Floor between request starts. `0` disables (tests / stubs). Default 1100. */
  minIntervalMs?: number;
  signal?: AbortSignal;
} = {}) {
  async function getJson<T>(url: string, busyRetries = BUSY_RETRIES): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await sharedGate.schedule(minIntervalMs, () => fetchWithTimeoutAndRetry({
        fetchImpl,
        url,
        timeoutMs,
        retries,
        signal,
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
      }), signal);
      if (response.ok) return (await response.json()) as T;
      if (response.status !== 503 || attempt >= busyRetries) {
        throw new Error(`musicbrainz request failed with status ${response.status}`);
      }
    }
  }

  return {
    async searchArtists(query: string) {
      const data = await getJson<MusicBrainzSearchResponse>(
        `${baseUrl}/artist?query=${encodeURIComponent(query)}&fmt=json&limit=5`,
      );
      const artists = Array.isArray(data.artists) ? data.artists : [];
      return artists.map((artist) => ({
        id: artist.id ?? "",
        name: artist.name ?? "",
        score: artist.score ?? 0,
        disambiguation: artist.disambiguation ?? "",
      }));
    },

    /**
     * Artists whose name contains any of the given names, in one request. The
     * caller decides which of them is meant: the answer also holds artists that
     * merely share words with a name.
     */
    async findArtistsByName(
      names: string[],
      { includeAliases = false }: { includeAliases?: boolean } = {},
    ): Promise<MusicBrainzArtistRecord[]> {
      const phrases = names.filter((name) => name.trim()).map(searchPhrase);
      if (phrases.length === 0) return [];
      const query = phrases
        .flatMap((phrase) => (includeAliases ? [`artist:${phrase}`, `alias:${phrase}`] : [`artist:${phrase}`]))
        .join(" OR ");
      const data = await getJson<MusicBrainzSearchResponse>(
        `${baseUrl}/artist?query=${encodeURIComponent(query)}&fmt=json&limit=100`,
        includeAliases ? BUSY_RETRIES_ALIASES : BUSY_RETRIES,
      );
      return (Array.isArray(data.artists) ? data.artists : [])
        .filter((artist) => Boolean(artist.id && artist.name))
        .map((artist) => ({
          id: artist.id!,
          name: artist.name!,
          score: artist.score ?? 0,
          aliases: namesOf(artist.aliases),
          tags: namesOf(artist.tags),
          lifeSpan: lifeSpanOf(artist["life-span"]),
        }));
    },

    async lookupArtist(mbid: string) {
      const id = String(mbid ?? "").trim();
      if (!id) {
        throw new Error("mbid is required for lookupArtist");
      }
      const data = await getJson<MusicBrainzArtistResponse>(
        `${baseUrl}/artist/${encodeURIComponent(id)}?fmt=json&inc=tags+genres+url-rels`,
      );

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

      return {
        id: typeof data.id === "string" ? data.id : id,
        name: typeof data.name === "string" ? data.name : "",
        tags: namesOf(data.tags),
        genres: namesOf(data.genres),
        urls,
        lifeSpan: lifeSpanOf(data["life-span"]),
        country: countryOf(data),
      };
    },

    /**
     * MusicBrainz ids of the people recorded as members of a band (past and
     * present). A separate request with inc=artist-rels, so the URL of
     * lookupArtist — and the eval replay recordings keyed on it — stay as they
     * are.
     */
    async lookupBandMembers(mbid: string): Promise<string[]> {
      const id = String(mbid ?? "").trim();
      if (!id) throw new Error("mbid is required for lookupBandMembers");
      const data = await getJson<MusicBrainzArtistResponse>(
        `${baseUrl}/artist/${encodeURIComponent(id)}?fmt=json&inc=artist-rels`,
      );
      return (Array.isArray(data.relations) ? data.relations : [])
        .filter((rel) => rel?.type === "member of band" && rel.direction === "backward")
        .map((rel) => rel.artist?.id)
        .filter((memberId): memberId is string => typeof memberId === "string" && memberId !== "");
    },
  };
}
