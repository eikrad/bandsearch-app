export async function fetchWithTimeoutAndRetry({
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
}): Promise<Response> {
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
