export async function fetchWithTimeoutAndRetry({
  fetchImpl,
  url,
  timeoutMs,
  retries,
  headers,
  signal,
}: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  retries: number;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      signal?.throwIfAborted();
      lastError = error;
    }
  }
  throw lastError;
}
