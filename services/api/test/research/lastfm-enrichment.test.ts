import test from "node:test";
import assert from "node:assert/strict";

import { createLastFmClient, type LastFmClientConfig } from "../../src/eval/lastFmClient.js";

type FetchLike = LastFmClientConfig["fetchImpl"];

function mockFetch(responses: Record<string, unknown>): FetchLike {
  return async (url: string) => {
    for (const [pattern, body] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return { ok: true, json: async () => body };
      }
    }
    return { ok: false, json: async () => ({}) };
  };
}

test("getSimilarArtists returns parsed similar artists", async () => {
  const client = createLastFmClient({
    apiKey: "test-key",
    fetchImpl: mockFetch({
      "method=artist.getSimilar": {
        similarartists: {
          artist: [
            { name: "Band A", match: "0.85" },
            { name: "Band B", match: "0.42" },
          ],
        },
      },
    }),
  });

  const result = await client.getSimilarArtists("Anchor Band");
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "Band A");
  assert.equal(result[0].match, 0.85);
  assert.equal(result[1].name, "Band B");
  assert.equal(result[1].match, 0.42);
});

test("getSimilarArtists returns empty array on API error", async () => {
  const client = createLastFmClient({
    apiKey: "test-key",
    fetchImpl: mockFetch({
      "method=artist.getSimilar": { error: 6 },
    }),
  });

  const result = await client.getSimilarArtists("Unknown");
  assert.deepEqual(result, []);
});

test("getSimilarArtists returns empty array when no API key", async () => {
  const client = createLastFmClient({ apiKey: "" });
  const result = await client.getSimilarArtists("Anything");
  assert.deepEqual(result, []);
});

test("getSimilarArtists filters entries with empty names", async () => {
  const client = createLastFmClient({
    apiKey: "test-key",
    fetchImpl: mockFetch({
      "method=artist.getSimilar": {
        similarartists: {
          artist: [
            { name: "Good", match: "0.9" },
            { name: "", match: "0.5" },
            { name: "  ", match: "0.3" },
          ],
        },
      },
    }),
  });

  const result = await client.getSimilarArtists("Anchor");
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Good");
});

test("getSimilarArtists returns empty array on network failure", async () => {
  const client = createLastFmClient({
    apiKey: "test-key",
    fetchImpl: async () => { throw new Error("network down"); },
  });

  const result = await client.getSimilarArtists("Band");
  assert.deepEqual(result, []);
});
