import test from "node:test";
import assert from "node:assert/strict";
import { createLastFmClient } from "../../src/eval/lastFmClient.js";
import type { LastFmClientConfig } from "../../src/eval/lastFmClient.js";

type FetchLike = NonNullable<LastFmClientConfig["fetchImpl"]>;

function fetchReturning(body: unknown, { ok = true, status = 200 } = {}): FetchLike {
  return async () => ({ ok, status, json: async () => body });
}

test("getListenerCount returns the listener count from artist.getInfo", async () => {
  const client = createLastFmClient({
    apiKey: "key",
    fetchImpl: fetchReturning({ artist: { stats: { listeners: "12345" } } }),
  });
  const count = await client.getListenerCount("Lustmord");
  assert.equal(count, 12345);
});

test("getListenerCount returns null when api key is missing", async () => {
  let called = false;
  const client = createLastFmClient({
    apiKey: "",
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; },
  });
  const count = await client.getListenerCount("Lustmord");
  assert.equal(count, null);
  assert.equal(called, false);
});

test("getListenerCount returns null on non-200 response", async () => {
  const client = createLastFmClient({
    apiKey: "key",
    fetchImpl: fetchReturning({}, { ok: false, status: 404 }),
  });
  const count = await client.getListenerCount("Unknown Artist");
  assert.equal(count, null);
});

test("getListenerCount returns null when Last.fm returns an error payload", async () => {
  const client = createLastFmClient({
    apiKey: "key",
    fetchImpl: fetchReturning({ error: 6, message: "The artist you supplied could not be found" }),
  });
  const count = await client.getListenerCount("Nonexistent");
  assert.equal(count, null);
});

test("getListenerCount returns null when fetch throws (timeout/network)", async () => {
  const client = createLastFmClient({
    apiKey: "key",
    fetchImpl: async () => { throw new Error("timeout"); },
  });
  const count = await client.getListenerCount("Lustmord");
  assert.equal(count, null);
});

test("getListenerCount returns null when listeners is not a number", async () => {
  const client = createLastFmClient({
    apiKey: "key",
    fetchImpl: fetchReturning({ artist: { stats: { listeners: "not-a-number" } } }),
  });
  const count = await client.getListenerCount("Lustmord");
  assert.equal(count, null);
});

test("getListenerCount returns null for empty artist name", async () => {
  let called = false;
  const client = createLastFmClient({
    apiKey: "key",
    fetchImpl: async () => { called = true; return { ok: true, json: async () => ({}) }; },
  });
  const count = await client.getListenerCount("   ");
  assert.equal(count, null);
  assert.equal(called, false);
});

// ─── getTopTags (#250: coverage for bands MusicBrainz has no tags for) ────────

test("getTopTags returns listener tags with their weight, by MusicBrainz id when known", async () => {
  const urls: string[] = [];
  const client = createLastFmClient({
    apiKey: "key",
    fetchImpl: async (url) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => ({ toptags: { tag: [{ name: "blackgaze", count: 100 }, { name: "seen live", count: 3 }] } }),
      };
    },
  });

  const tags = await client.getTopTags("Fen", "mbid-fen");

  assert.deepEqual(tags, [
    { name: "blackgaze", count: 100 },
    { name: "seen live", count: 3 },
  ]);
  assert.match(urls[0]!, /method=artist\.gettoptags/);
  assert.match(urls[0]!, /mbid=mbid-fen/);
});

test("getTopTags looks the artist up by name when there is no MusicBrainz id", async () => {
  const urls: string[] = [];
  const client = createLastFmClient({
    apiKey: "key",
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ toptags: { tag: [] } }) };
    },
  });

  await client.getTopTags("Les Discrets");

  assert.match(urls[0]!, /artist=Les%20Discrets/);
  assert.doesNotMatch(urls[0]!, /mbid=/);
});

test("getTopTags returns null when Last.fm fails, which is not the same as no tags", async () => {
  const failing = createLastFmClient({ apiKey: "key", fetchImpl: fetchReturning({}, { ok: false, status: 500 }) });
  const unknown = createLastFmClient({ apiKey: "key", fetchImpl: fetchReturning({ error: 6, message: "not found" }) });

  assert.equal(await failing.getTopTags("Fen"), null);
  assert.deepEqual(await unknown.getTopTags("Fen"), [], "an unknown artist has no tags");
});
