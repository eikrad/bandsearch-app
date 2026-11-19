import test from "node:test";
import assert from "node:assert/strict";
import { createStatusMessage } from "../src/statusMessage.js";

/** A timer the test fires by hand; records each delay asked for. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let next = 1;
  return {
    delays,
    setTimeoutImpl: (fn: () => void, ms: number) => { delays.push(ms); pending.set(next, fn); return next++; },
    clearTimeoutImpl: (handle: unknown) => { pending.delete(handle as number); },
    fireAll: () => { for (const [id, fn] of [...pending]) { pending.delete(id); fn(); } },
    pendingCount: () => pending.size,
  };
}

test("a confirmation clears after 3 s and an error after 10 (UI_GUIDELINES)", () => {
  const timers = fakeTimers();
  const status = createStatusMessage(timers);

  status.show({ type: "success", message: "Saved Fen." });
  status.show({ type: "error", message: "Save failed for Fen." });

  assert.deepEqual(timers.delays, [3000, 10000]);
});

test("a cleared message is gone and listeners hear about it", () => {
  const timers = fakeTimers();
  const status = createStatusMessage(timers);
  let heard = 0;
  status.subscribe(() => { heard += 1; });

  status.show({ type: "success", message: "Saved Fen." });
  assert.deepEqual(status.get(), { type: "success", message: "Saved Fen." });
  timers.fireAll();

  assert.equal(status.get(), null);
  assert.equal(heard, 1);
});

test("a newer message restarts the clock rather than being cleared by the older timer", () => {
  const timers = fakeTimers();
  const status = createStatusMessage(timers);

  status.show({ type: "success", message: "Saved Fen." });
  status.show({ type: "success", message: "Saved Duster." });

  assert.equal(timers.pendingCount(), 1, "the first timer was cancelled");
});

test("an unsubscribed listener is not called", () => {
  const timers = fakeTimers();
  const status = createStatusMessage(timers);
  let heard = 0;
  const unsubscribe = status.subscribe(() => { heard += 1; });

  unsubscribe();
  status.show({ type: "success", message: "Saved Fen." });
  timers.fireAll();

  assert.equal(heard, 0);
});
