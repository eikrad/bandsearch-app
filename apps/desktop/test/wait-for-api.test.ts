import test from "node:test";
import assert from "node:assert/strict";

import { waitForAuthStatus } from "../src/waitForApi.js";
import type { AuthStatus } from "../src/authApiClient.js";

const UP: AuthStatus = { reachable: true, enabled: true, userCount: 2 };
const DOWN: AuthStatus = { reachable: false, reason: "http_502" };

/**
 * A clock the test drives. `sleep` advances it instead of waiting, so the
 * budget is exercised deterministically and the suite stays instant.
 */
function fakeClock() {
  let now = 0;
  const slept: number[] = [];
  return {
    now: () => now,
    slept,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
  };
}

/** Answers `DOWN` the given number of times, then `UP`. */
function apiDownFor(attempts: number) {
  let calls = 0;
  return {
    getStatus: async (): Promise<AuthStatus> => {
      calls += 1;
      return calls > attempts ? UP : DOWN;
    },
    callCount: () => calls,
  };
}

test("an API that answers immediately is not retried or slept on", async () => {
  const clock = fakeClock();
  const api = apiDownFor(0);

  const status = await waitForAuthStatus({ getStatus: api.getStatus, ...clock });

  assert.deepEqual(status, UP);
  assert.equal(api.callCount(), 1);
  assert.deepEqual(clock.slept, [], "a healthy API must not delay startup");
});

test("a waking API is retried until it answers", async () => {
  const clock = fakeClock();
  const api = apiDownFor(3);

  const status = await waitForAuthStatus({ getStatus: api.getStatus, ...clock });

  assert.deepEqual(status, UP, "the eventual answer is what the caller gets");
  assert.equal(api.callCount(), 4);
});

test("retries back off instead of hammering the waking instance", async () => {
  const clock = fakeClock();
  const api = apiDownFor(4);

  await waitForAuthStatus({ getStatus: api.getStatus, ...clock });

  // Strictly increasing until the cap: a spun-down Render instance takes tens of
  // seconds, and retrying every 100ms would just pile requests onto its boot.
  assert.ok(clock.slept.length >= 3, `expected several waits, got ${clock.slept.length}`);
  assert.ok(clock.slept[1] > clock.slept[0], "the second wait should be longer than the first");
  assert.ok(
    clock.slept.every((ms) => ms <= 8000),
    `no single wait should exceed the 8s cap, got ${clock.slept.join(", ")}`,
  );
});

test("giving up reports the last failure rather than a healthy-looking answer", async () => {
  const clock = fakeClock();
  const alwaysDown = async (): Promise<AuthStatus> => DOWN;

  const status = await waitForAuthStatus({ getStatus: alwaysDown, ...clock, budgetMs: 5000 });

  assert.deepEqual(status, DOWN, "the caller must still see that the API never answered");
});

test("waiting stops once the budget is spent", async () => {
  const clock = fakeClock();
  let calls = 0;
  const alwaysDown = async (): Promise<AuthStatus> => { calls += 1; return DOWN; };

  await waitForAuthStatus({ getStatus: alwaysDown, ...clock, budgetMs: 5000 });

  assert.ok(clock.now() <= 5000 + 8000, `waited far past the budget: ${clock.now()}ms`);
  assert.ok(calls < 50, `retried without bound: ${calls} attempts`);
});

test("each attempt is reported so the caller can show progress", async () => {
  const clock = fakeClock();
  const api = apiDownFor(2);
  const seen: number[] = [];

  await waitForAuthStatus({
    getStatus: api.getStatus,
    ...clock,
    onAttempt: ({ attempt }) => seen.push(attempt),
  });

  // Without this the connecting screen cannot tell "still trying" from "hung".
  assert.deepEqual(seen, [1, 2, 3]);
});
