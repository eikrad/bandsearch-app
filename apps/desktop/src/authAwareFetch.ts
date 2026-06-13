export function createAuthAwareFetch(
  baseFetch: typeof fetch,
  onInvalidToken: () => void,
): typeof fetch {
  return async function authAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await baseFetch(input, init);
    if (response.status === 401) {
      try {
        const cloned = response.clone();
        const body = await cloned.json() as Record<string, unknown>;
        const err = body?.error as { code?: string; message?: string } | undefined;
        if (err?.message === "invalid token") {
          onInvalidToken();
        }
      } catch { /* non-JSON body — not an invalid token error */ }
    }
    return response;
  };
}
