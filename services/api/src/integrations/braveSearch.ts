const DEFAULT_BASE_URL = "https://api.search.brave.com";
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

export function normalizeQueryKey(query: string) {
  return String(query || "").trim().toLowerCase();
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createBraveSearchClient(opts: {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  dedupCache?: Map<string, CacheEntry>;
  /** Minimum delay between successive requests; the Brave Free plan allows 1 req/sec. */
  minRequestSpacingMs?: number;
  /** Delay before retrying after an HTTP 429. */
  rateLimitRetryMs?: number;
  /** How many times to retry a 429 before giving up and returning empty results. */
  rateLimitMaxRetries?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
} = {}) {
  const {
    fetchImpl = fetch,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = 5000,
    retries = 1,
    dedupCache,
    minRequestSpacingMs = 1100,
    rateLimitRetryMs = 1100,
    rateLimitMaxRetries = 2,
    sleepImpl = defaultSleep,
    nowImpl = Date.now,
  } = opts;
  const key = String(apiKey ?? "").trim();
  if (!key) {
    throw new Error("apiKey is required for Brave Search client");
  }

  const cache = dedupCache ?? null;
  let lastRequestAt = 0;

  async function throttle() {
    if (minRequestSpacingMs <= 0) return;
    const wait = minRequestSpacingMs - (nowImpl() - lastRequestAt);
    if (wait > 0) {
      await sleepImpl(wait);
    }
    lastRequestAt = nowImpl();
  }

  return {
    async search(query: string, options: { count?: number } = {}) {
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
      for (let rateAttempt = 0; rateAttempt <= rateLimitMaxRetries; rateAttempt += 1) {
        await throttle();
        response = await fetchWithTimeoutAndRetry({ fetchImpl, url, timeoutMs, retries, headers });
        if (response.status !== 429) break;
        // Rate limited (Brave Free plan = 1 req/sec). Wait and retry; soft-fail if it persists.
        if (rateAttempt < rateLimitMaxRetries) {
          await sleepImpl(rateLimitRetryMs);
        }
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
