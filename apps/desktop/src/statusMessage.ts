/** A one-line outcome of a user action, shown on the screen where it happened. */
export type StatusMessage = { type: "success" | "error"; message: string };

/** Node returns a Timeout, browsers and test fakes return a number. */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

export type StatusMessageOptions = {
  confirmationMs?: number;
  errorMs?: number;
  // Only "schedule this, give me a handle I can cancel" is used, so the seam
  // does not need the full setTimeout signature (which drags in __promisify__
  // and forces fakes to be Node Timeouts).
  setTimeoutImpl?: (handler: () => void, timeout: number) => TimerHandle;
  clearTimeoutImpl?: (handle: TimerHandle) => void;
};

/**
 * The status line's lifecycle, shared by every screen that has one: a
 * confirmation clears itself after 3 s, an error after 10 (an error is the one
 * the user has to read), and a newer message restarts the clock.
 *
 * Clearing happens on a timer, not in a click handler that repaints anyway,
 * so whoever paints the screen subscribes to hear about it.
 */
export function createStatusMessage({
  confirmationMs = 3000,
  errorMs = 10000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: StatusMessageOptions = {}) {
  let current: StatusMessage | null = null;
  let timer: TimerHandle | null = null;
  const listeners = new Set<() => void>();

  return {
    get: (): StatusMessage | null => current,
    show(status: StatusMessage): void {
      current = status;
      if (timer !== null) clearTimeoutImpl(timer);
      timer = setTimeoutImpl(() => {
        current = null;
        timer = null;
        for (const listener of listeners) listener();
      }, status.type === "error" ? errorMs : confirmationMs);
    },
    /** Calls `listener` when the message clears itself. Returns an unsubscribe. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
