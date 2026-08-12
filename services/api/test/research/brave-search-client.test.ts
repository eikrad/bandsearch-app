import test from "node:test";
import assert from "node:assert/strict";
import { createBraveSearchClient as createClient } from "../../src/integrations/braveSearch.js";

type BraveClientOptions = Parameters<typeof createClient>[0];
type FetchCall = { url: string; headers: Headers };

function createBraveSearchClient(options: BraveClientOptions) {
  return createClient(options);
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

test("search retries on 429 then succeeds", async () => {
  let attempt = 0;
  const fetchImpl = async () => {
    attempt += 1;
    if (attempt === 1) {
      return jsonResponse({ error: "rate limited" }, 429);
    }
    return jsonResponse({ web: { results: [{ title: "ok", url: "https://ok", description: "" }] } });
  };

  const sleeps: number[] = [];
  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "k",
    retries: 0,
    minRequestSpacingMs: 0,
    rateLimitRetryMs: 1100,
    sleepImpl: async (ms) => { sleeps.push(ms); },
  });

  const out = await client.search("q");
  assert.equal(out.results.length, 1);
  assert.equal(attempt, 2);
  assert.ok(sleeps.includes(1100), "should wait the rate-limit interval before retrying");
});

test("search returns empty results when 429 persists after retries", async () => {
  let attempt = 0;
  const fetchImpl = async () => {
    attempt += 1;
    return jsonResponse({ error: "rate limited" }, 429);
  };

  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "k",
    retries: 0,
    minRequestSpacingMs: 0,
    rateLimitRetryMs: 1,
    rateLimitMaxRetries: 2,
    sleepImpl: async () => {},
  });

  const out = await client.search("q");
  assert.deepEqual(out.results, []);
  assert.equal(out.fromDuplicateCache, false);
  assert.equal(attempt, 3, "initial attempt plus 2 retries");
});

test("search throttles sequential requests to the minimum spacing", async () => {
  const fetchImpl = async () => jsonResponse({ web: { results: [] } });

  const sleeps: number[] = [];
  let fakeNow = 1_000_000;
  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "k",
    retries: 0,
    minRequestSpacingMs: 1100,
    sleepImpl: async (ms) => { sleeps.push(ms); fakeNow += ms; },
    nowImpl: () => fakeNow,
  });

  await client.search("first");
  await client.search("second");

  assert.ok(
    sleeps.some((ms) => ms >= 1000),
    `second back-to-back request should be delayed ~1100ms, got sleeps=${JSON.stringify(sleeps)}`,
  );
});
