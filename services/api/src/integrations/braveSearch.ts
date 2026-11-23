import { fetchWithTimeoutAndRetry } from "./httpClient.js";
import { createRateGate, type RateGate } from "./rateGate.js";

const DEFAULT_BASE_URL = "https://api.search.brave.com";
/** The Brave Free plan allows 1 request per second. */
export const BRAVE_MIN_INTERVAL_MS = 1100;
/** How often a 429 is retried, each time in a new slot of the gate, before the query gives no results. */
const RATE_LIMIT_RETRIES = 2;
const USER_AGENT = "bandsearch-app/0.1.0 (https://github.com/eikrad/bandsearch-app)";

export class BraveSearchError extends Error {
  readonly status: number;
  constructor(status: number, detail = "") {
    super(`brave search failed with status ${status}${detail ? `: ${detail}` : ""}`);
    this.name = "BraveSearchError";
    this.status = status;
  }
}

type SearchResult = { title: string; url: string; description: string };
type CacheEntry = { results: SearchResult[]; fromDuplicateCache?: boolean };

type BraveSearchResponse = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
};

export function normalizeQueryKey(query: string) {
  return String(query || "").trim().toLowerCase();
}

/** Every Brave client in this process shares one rate limit: search rounds and concurrent users alike. */
const sharedGate = createRateGate();

export function createBraveSearchClient(opts: {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  dedupCache?: Map<string, CacheEntry>;
  /** Floor between request starts; 0 disables it (tests, replay). */
  minIntervalMs?: number;
  /** Where starts are spaced; the process-wide gate unless a test brings its own. */
  gate?: RateGate;
  signal?: AbortSignal;
} = {}) {
  const {
    fetchImpl = fetch,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = 5000,
    retries = 1,
    dedupCache,
    minIntervalMs = BRAVE_MIN_INTERVAL_MS,
    gate = sharedGate,
    signal: defaultSignal,
  } = opts;
  const key = String(apiKey ?? "").trim();
  if (!key) {
    throw new Error("apiKey is required for Brave Search client");
  }

  const cache = dedupCache ?? null;

  return {
    async search(query: string, options: { count?: number; signal?: AbortSignal } = {}) {
      const signal = options.signal ?? defaultSignal;
      signal?.throwIfAborted();
      const qKey = normalizeQueryKey(query);
      if (!qKey) {
        return { results: [] as SearchResult[], fromDuplicateCache: false };
      }

      if (cache && cache.has(qKey)) {
        const prev = cache.get(qKey)!;
        return {
          results: prev.results.map((r) => ({ ...r })),
          fromDuplicateCache: true,
        };
      }

      const count = Math.min(20, Math.max(1, Number(options.count) || 10));
      const encodedQuery = encodeURIComponent(String(query).trim());
      const url = `${baseUrl.replace(/\/$/, "")}/res/v1/web/search?q=${encodedQuery}&count=${count}`;
      const headers = {
        "user-agent": USER_AGENT,
        accept: "application/json",
        "accept-encoding": "gzip",
        "x-subscription-token": key,
      };

      let response: Awaited<ReturnType<typeof fetchWithTimeoutAndRetry>> | null = null;
      for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
        response = await gate.schedule(
          minIntervalMs,
          () => fetchWithTimeoutAndRetry({ fetchImpl, url, timeoutMs, retries, headers, signal }),
          signal,
        );
        if (response.status !== 429) break;
      }

      if (!response || response.status === 429) {
        return { results: [] as SearchResult[], fromDuplicateCache: false };
      }

      if (!response.ok) {
        let detail = "";
        try { detail = await response.text(); } catch { /* ignore */ }
        throw new BraveSearchError(response.status, detail.slice(0, 300));
      }

      const data = await response.json() as BraveSearchResponse;
      const raw = Array.isArray(data.web?.results) ? data.web!.results! : [];
      const results: SearchResult[] = raw.map((r) => ({
        title: typeof r.title === "string" ? r.title : "",
        url: typeof r.url === "string" ? r.url : "",
        description: typeof r.description === "string" ? r.description : "",
      }));

      const payload = { results, fromDuplicateCache: false };
      if (cache) {
        cache.set(qKey, { results: payload.results.map((r) => ({ ...r })) });
      }
      return payload;
    },
  };
}
