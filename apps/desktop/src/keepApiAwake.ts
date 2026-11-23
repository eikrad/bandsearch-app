/** Render's free plan puts an idle service to sleep after 15 minutes; waking it takes 30–60 s. */
const PING_INTERVAL_MS = 10 * 60 * 1000;
/** A window left open without anyone using it lets the service sleep. */
const IDLE_AFTER_MS = 30 * 60 * 1000;

/** The slice of `document` this needs; tests bring their own. */
type AwakeDocument = {
  visibilityState: string;
  addEventListener(type: string, listener: () => void): void;
};

const isLocal = (baseUrl: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(baseUrl);

/**
 * Keeps a hosted API awake while the app is being used, and wakes it as soon as
 * the user comes back, so a message does not wait for a cold start. The ping is
 * the public health check and carries nothing about the user. Nothing to do for
 * the local sidecar.
 */
export function keepApiAwake({
  apiBaseUrl,
  fetchImpl,
  document,
  setIntervalImpl = setInterval,
  now = Date.now,
}: {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  document: AwakeDocument | undefined;
  setIntervalImpl?: (handler: () => void, ms: number) => unknown;
  now?: () => number;
}): void {
  if (!document || isLocal(apiBaseUrl)) return;
  let lastUsed = now();
  let lastPing = now();

  function ping() {
    lastPing = now();
    void fetchImpl(`${apiBaseUrl}/health`).catch(() => {});
  }

  // Back after a while: the service is asleep, and the user is about to type.
  function used() {
    lastUsed = now();
    if (now() - lastPing >= PING_INTERVAL_MS) ping();
  }

  for (const event of ["pointerdown", "keydown"]) document.addEventListener(event, used);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") used();
  });
  setIntervalImpl(() => {
    if (document.visibilityState === "visible" && now() - lastUsed < IDLE_AFTER_MS) ping();
  }, PING_INTERVAL_MS);
}
