import type { AuthStatus } from "./authApiClient.js";

/** First wait after a failed attempt. Short, so a brief blip costs nothing. */
const INITIAL_DELAY_MS = 500;
/** Each wait doubles up to here — long enough not to pile onto a booting instance. */
const MAX_DELAY_MS = 8_000;
/**
 * Total time to keep trying. A spun-down Render free-tier instance takes 30–60s
 * to serve its first request, so a budget under that would give up exactly when
 * waiting was about to pay off.
 */
const DEFAULT_BUDGET_MS = 90_000;

export type WaitForAuthStatusOptions = {
  getStatus: () => Promise<AuthStatus>;
  /** Injected so tests drive time instead of waiting for it. */
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Fires before each attempt, so a connecting view can show progress. */
  onAttempt?: (info: { attempt: number }) => void;
  budgetMs?: number;
};

/**
 * Polls `/auth/status` until it answers, or until the budget runs out.
 *
 * Returns the last status either way: an unreachable result after giving up is
 * still the truth, and the caller must be able to tell it apart from a healthy
 * answer. Never throws — "the API is down" is an outcome here, not an error.
 */
export async function waitForAuthStatus({
  getStatus,
  sleep,
  now,
  onAttempt,
  budgetMs = DEFAULT_BUDGET_MS,
}: WaitForAuthStatusOptions): Promise<AuthStatus> {
  const startedAt = now();
  let delayMs = INITIAL_DELAY_MS;
  let attempt = 0;

  for (;;) {
    attempt += 1;
    onAttempt?.({ attempt });

    const status = await getStatus();
    if (status.reachable) return status;

    // Check the budget before sleeping, so giving up does not add a final
    // pointless wait on top of it.
    if (now() - startedAt + delayMs > budgetMs) return status;

    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
}
