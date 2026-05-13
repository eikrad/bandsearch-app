const test = require("node:test");
const assert = require("node:assert/strict");

const { createBraveSearchClient } = require("../../src/integrations/braveSearch");

test("search maps Brave web.results to title url description", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    assert.ok(String(url).includes("api.search.brave.com/res/v1/web/search"));
    assert.ok(opts.headers["x-subscription-token"]);
    return {
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "A", url: "https://a.example", description: "snippet a" },
            { title: "B", url: "https://b.example", description: "snippet b" },
          ],
        },
      }),
    };
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
    return {
      ok: true,
      json: async () => ({ web: { results: [{ title: "x", url: "https://x", description: "" }] } }),
    };
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
    return {
      ok: true,
      json: async () => ({
        web: { results: [{ title: "only", url: "https://only", description: "d" }] },
      }),
    };
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

test("search throws when response not ok", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    json: async () => ({}),
  });

  const client = createBraveSearchClient({
    fetchImpl,
    apiKey: "k",
    retries: 0,
  });

  await assert.rejects(() => client.search("x"), /brave search failed with status 429/);
});
