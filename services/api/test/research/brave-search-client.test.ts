import test from "node:test";
import { setImmediate } from "node:timers/promises";
import assert from "node:assert/strict";
import { createBraveSearchClient as createClient } from "../../src/integrations/braveSearch.js";
import { createRateGate } from "../../src/integrations/rateGate.js";

type BraveClientOptions = Parameters<typeof createClient>[0];
type FetchCall = { url: string; headers: Headers };

/** A client without spacing, on a gate of its own, unless a test says otherwise. */
function createBraveSearchClient(options: BraveClientOptions) {
  return createClient({ minIntervalMs: 0, gate: createRateGate(), ...options });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("search maps Brave web.results to title url description", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (url, opts) => {
    const headers = new Headers(opts?.headers);
    calls.push({ url: String(url), headers });
    assert.ok(String(url).includes("api.search.brave.com/res/v1/web/search"));
    assert.ok(headers.get("x-subscription-token"));
    return jsonResponse({
      web: {
        results: [
          { title: "A", url: "https://a.example", description: "snippet a" },
          { title: "B", url: "https://b.example", description: "snippet b" },
        ],
      },
    });
  };

  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "secret-token",
    timeoutMs: 5000,
    retries: 0,
  });

  const out = await client.search("FFO Grade hardcore", { count: 5 });

  assert.equal(out.results.length, 2);
  assert.deepEqual(out.results[0], {
    title: "A",
    url: "https://a.example",
    description: "snippet a",
  });
  assert.equal(calls.length, 1);
});

test("search retries once on abort failure then succeeds", async () => {
  let attempt = 0;
  const fetchImpl = async () => {
    attempt += 1;
    if (attempt === 1) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    return jsonResponse({ web: { results: [{ title: "x", url: "https://x", description: "" }] } });
  };

  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "k",
    timeoutMs: 5000,
    retries: 1,
  });

  const out = await client.search("q");
  assert.equal(out.results.length, 1);
  assert.equal(attempt, 2);
});

test("dedupSet skips duplicate query network calls on second search", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse({
      web: { results: [{ title: "only", url: "https://only", description: "d" }] },
    });
  };

  const dedupSet = new Map();
  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "k",
    dedupCache: dedupSet,
    timeoutMs: 5000,
    retries: 0,
  });

  const first = await client.search("  Same Query  ");
  const second = await client.search("same query");

  assert.equal(first.results.length, 1);
  assert.deepEqual(second.results, first.results);
  assert.equal(second.fromDuplicateCache, true);
  assert.equal(calls, 1);
});

test("search throws when response not ok (non-429)", async () => {
  const fetchImpl = async () => jsonResponse({}, 500);

  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "k",
    retries: 0,
  });

  await assert.rejects(() => client.search("x"), /brave search failed with status 500/);
});

test("search retries on 429 in its own slot of the rate gate, then succeeds", async () => {
  const startedAt: number[] = [];
  const fetchImpl = async () => {
    startedAt.push(Date.now());
    if (startedAt.length === 1) return jsonResponse({ error: "rate limited" }, 429);
    return jsonResponse({ web: { results: [{ title: "ok", url: "https://ok", description: "" }] } });
  };

  const client = createBraveSearchClient({ fetchImpl, apiKey: "k", retries: 0, minIntervalMs: 40 });

  const out = await client.search("q");
  assert.equal(out.results.length, 1);
  assert.equal(startedAt.length, 2);
  assert.ok(startedAt[1]! - startedAt[0]! >= 35, `retry gap too small: ${startedAt[1]! - startedAt[0]!}ms`);
});

test("search returns empty results when 429 persists after retries", async () => {
  let attempt = 0;
  const fetchImpl = async () => {
    attempt += 1;
    return jsonResponse({ error: "rate limited" }, 429);
  };

  const client = createBraveSearchClient({ fetchImpl, apiKey: "k", retries: 0 });

  const out = await client.search("q");
  assert.deepEqual(out.results, []);
  assert.equal(out.fromDuplicateCache, false);
  assert.equal(attempt, 3, "initial attempt plus 2 retries");
});

test("clients of one process share the rate limit: two rounds, or two users, do not collide", async () => {
  const startedAt: number[] = [];
  const fetchImpl = async () => {
    startedAt.push(Date.now());
    return jsonResponse({ web: { results: [] } });
  };
  const gate = createRateGate();
  const clients = ["a", "b", "c"].map(() => createBraveSearchClient({ fetchImpl, apiKey: "k", retries: 0, minIntervalMs: 40, gate }));

  await Promise.all(clients.map((client, i) => client.search(`query ${i}`)));

  assert.equal(startedAt.length, 3);
  assert.ok(startedAt[1]! - startedAt[0]! >= 35);
  assert.ok(startedAt[2]! - startedAt[1]! >= 35);
});

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await setImmediate();
}

test("cancellation interrupts the wait after a 429 and sends no retry", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const controller = new AbortController();
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests += 1;
    return jsonResponse({ error: "rate limited" }, 429);
  };
  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "k",
    retries: 0,
    minIntervalMs: 60_000,
  });

  let settled = false;
  const outcome = client.search("q", { signal: controller.signal })
    .then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
  await flushMicrotasks();
  controller.abort(new Error("research deadline"));
  try {
    await flushMicrotasks();
    assert.equal(settled, true, "the rate-limit wait must end when the run is cancelled");
    assert.ok(await outcome, "a cancelled search rejects instead of returning results");
    t.mock.timers.tick(120_000);
    await flushMicrotasks();
    assert.equal(requests, 1, "no retry is sent after cancellation");
  } finally {
    t.mock.timers.tick(120_000);
    await outcome;
  }
});

test("cancellation interrupts the spacing wait before the next request", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const controller = new AbortController();
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests += 1;
    return jsonResponse({ web: { results: [] } });
  };
  const client = createBraveSearchClient({ fetchImpl, apiKey: "k", retries: 0, minIntervalMs: 60_000 });

  await client.search("first");
  let settled = false;
  const outcome = client.search("second", { signal: controller.signal })
    .then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
  await flushMicrotasks();
  controller.abort(new Error("research deadline"));
  try {
    await flushMicrotasks();
    assert.equal(settled, true, "the spacing wait must end when the run is cancelled");
    assert.ok(await outcome);
    t.mock.timers.tick(120_000);
    await flushMicrotasks();
    assert.equal(requests, 1, "the second request is never sent");
  } finally {
    t.mock.timers.tick(120_000);
    await outcome;
  }
});
