import test from "node:test";
import assert from "node:assert/strict";

import { setImmediate } from "node:timers/promises";

import { createLastFmClient, type LastFmClient, type LastFmClientConfig, type SimilarArtist } from "../../src/eval/lastFmClient.js";
import type { VerifiedCandidate } from "../../src/agent/research/candidateVerifier.js";
import { createLastFmEnrichment } from "../../src/agent/research/lastFmEnrichment.js";
import { createResearchBudget } from "../../src/agent/research/researchBudget.js";
import { createResearchCache, type ResearchCache } from "../../src/agent/research/researchCache.js";

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

// ─── alongside the search (#336) ─────────────────────────────────────────────

function candidate(name: string, canonicalName = name): VerifiedCandidate {
  return { name, canonicalName, verified: true, evidenceUrls: ["https://blog.example"], evidenceSnippets: [], sourceQueries: [] };
}

function fakeLastFm(answers: { listeners?: (name: string) => Promise<number | null>; similar?: SimilarArtist[] }) {
  const asked: string[] = [];
  const client: LastFmClient = {
    async getListenerCount(name) {
      asked.push(name);
      return answers.listeners ? answers.listeners(name) : 1000;
    },
    async getSimilarArtists(anchor) {
      asked.push(`similar:${anchor}`);
      return answers.similar ?? [];
    },
    async getTopTags() {
      return null;
    },
  };
  return { client, asked };
}

function enrichmentWith(client: LastFmClient, overrides: { budgetMs?: number; cache?: ResearchCache } = {}) {
  const events: string[] = [];
  return {
    events,
    lastFm: createLastFmEnrichment({
      clientFor: () => client,
      budget: createResearchBudget(overrides.budgetMs ?? 60_000),
      cache: overrides.cache,
      log: (_level, event) => events.push(event),
    }),
  };
}

test("lookups started early are not repeated when the candidates are ready", async () => {
  const { client, asked } = fakeLastFm({ similar: [{ name: "fen", match: 0.9 }] });
  const { lastFm } = enrichmentWith(client);
  lastFm.prefetchSimilar(["Alcest"]);
  lastFm.prefetchListeners(["Fen"]);

  const [fen] = await lastFm.enrich([candidate("Fen")], ["Alcest"]);

  assert.deepEqual(asked, ["similar:Alcest", "Fen"]);
  assert.equal(fen!.listenerCount, 1000);
  assert.deepEqual(fen!.evidenceSnippets, ["Similar to Alcest on last.fm (match: 0.90)"]);
  assert.ok(fen!.evidenceUrls.includes("https://www.last.fm/music/Alcest/+similar"));
});

test("the count under the MusicBrainz name counts; the found spelling is the fallback", async () => {
  const counts: Record<string, number | null> = { Haino: 5, "Keiji Haino": 90_000, 明日の叙景: null, Asunojokei: 41_000 };
  const { client } = fakeLastFm({ listeners: async (name) => counts[name] ?? null });
  const { lastFm } = enrichmentWith(client);
  const out = await lastFm.enrich([candidate("Haino", "Keiji Haino"), candidate("Asunojokei", "明日の叙景")], []);
  assert.deepEqual(out.map((c) => c.listenerCount), [90_000, 41_000]);
});

test("a slow answer does not cost the counts that did arrive", async (t) => {
  // One answer over 5 s used to discard every count, which turned the obscurity filter off.
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const { client } = fakeLastFm({ listeners: (name) => (name === "Slow" ? new Promise(() => {}) : Promise.resolve(42_000)) });
  const { lastFm, events } = enrichmentWith(client);
  const result = lastFm.enrich([candidate("Fen"), candidate("Slow")], []);
  for (let i = 0; i < 10; i++) await setImmediate();
  t.mock.timers.tick(5000);
  assert.deepEqual((await result).map((c) => c.listenerCount), [42_000, null]);
  assert.ok(events.includes("research_lastfm_incomplete"));
});

test("a failing lookup leaves its band without a count", async () => {
  const { client } = fakeLastFm({ listeners: async (name) => { if (name === "Bad") throw new Error("down"); return 7; } });
  const { lastFm } = enrichmentWith(client);
  assert.deepEqual((await lastFm.enrich([candidate("Bad"), candidate("Fen")], [])).map((c) => c.listenerCount), [null, 7]);
});

test("facts known from an earlier search are not asked for again; failures are", async () => {
  const cache = createResearchCache();
  const first = fakeLastFm({ listeners: async (name) => (name === "Fen" ? 42_000 : null), similar: [{ name: "Fen", match: 0.5 }] });
  await enrichmentWith(first.client, { cache }).lastFm.enrich([candidate("Fen"), candidate("Missing")], ["Alcest"]);

  const second = fakeLastFm({});
  const out = await enrichmentWith(second.client, { cache }).lastFm.enrich([candidate("FEN"), candidate("Missing")], ["alcest"]);
  assert.deepEqual(second.asked, ["Missing"]);
  assert.equal(out[0]!.listenerCount, 42_000);
});
