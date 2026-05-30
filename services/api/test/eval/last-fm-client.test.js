const test = require("node:test");
const assert = require("node:assert/strict");

const { createLastFmClient } = require("../../src/eval/lastFmClient");

function fetchReturning(body, { ok = true, status = 200 } = {}) {
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
