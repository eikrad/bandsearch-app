/* eslint-disable @typescript-eslint/no-explicit-any */
const DEFAULT_BASE_URL = "https://api.search.brave.com";
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

export function normalizeQueryKey(query: string) {
  return String(query || "").trim().toLowerCase();
}

type SearchResult = { title: string; url: string; description: string };
type CacheEntry = { results: SearchResult[]; fromDuplicateCache?: boolean };

export function createBraveSearchClient(opts: {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  dedupCache?: Map<string, CacheEntry>;
} = {}) {
  const {
    fetchImpl = fetch,
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = 5000,
    retries = 1,
    dedupCache,
  } = opts;
  const key = String(apiKey ?? "").trim();
  if (!key) {
    throw new Error("apiKey is required for Brave Search client");
  }

  const cache = dedupCache ?? null;

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

      const response = await fetchWithTimeoutAndRetry({
        fetchImpl,
        url,
        timeoutMs,
        retries,
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json",
          "x-subscription-token": key,
        },
      });

      if (!response.ok) {
        throw new Error(`brave search failed with status ${response.status}`);
      }

      const data: any = await response.json();
      const raw = Array.isArray(data.web?.results) ? data.web.results : [];
      const results: SearchResult[] = raw.map((r: any) => ({
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
