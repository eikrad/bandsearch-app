import { setTimeout as delay } from "node:timers/promises";

export type RateGate = {
  /** Runs `work` at least `minIntervalMs` after the previous start; cancelled while waiting, it never starts. */
  schedule<T>(minIntervalMs: number, work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
};

/**
 * Spaces request starts for an upstream that limits requests per second. One
 * gate per upstream and process: clients with a queue of their own would
 * together exceed the limit.
 */
export function createRateGate(): RateGate {
  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = 0;

  return {
    async schedule(minIntervalMs, work, signal) {
      signal?.throwIfAborted();
      if (minIntervalMs <= 0) return work();
      const slot = queue.then(async () => {
        signal?.throwIfAborted();
        // Never longer than one interval, even when the clock was set back.
        const wait = Math.min(minIntervalMs, lastStart + minIntervalMs - Date.now());
        if (wait > 0) await delay(wait, undefined, { signal });
        lastStart = Date.now();
      });
      queue = slot.catch(() => undefined);
      await slot;
      signal?.throwIfAborted();
      return work();
    },
  };
}
