import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAntiBandRate,
  computeNuggetCoverage,
  createTagLookup,
  createTagResolver,
  findUncoveredNuggets,
  goldenErrorResult,
  MB_POST_RECOMMENDATION_COOLDOWN_MS,
  normalizeTerm,
  runGoldenEntriesSequentially,
  runGoldenEntry,
  type GoldenResult,
} from "./run-golden.ts";

// computePrecisionAtK and its tests were removed: it divided hits by the size of
// the reference set rather than by k, so it computed recall@k under a precision
// name — and it was called with the same `nuggets` list as computeNuggetCoverage,
// making the two functions return identical values.
//
// computeNuggetCoverage itself was then rewired: `nuggets` used to hold band
// names matched against result names, which made it a second exact-match recall
// metric. It now holds sonic properties matched against the MusicBrainz
// tags/genres of the recommended bands, as the eval architecture doc specifies.

// ─── computeAntiBandRate ──────────────────────────────────────────────────────

test("computeAntiBandRate returns 0 when no anti-bands in results", () => {
  const antiBands = ["Imagine Dragons", "Coldplay"];
  const results = ["Alcest", "Fen", "Les Discrets"];
  assert.equal(computeAntiBandRate(antiBands, results, 8), 0);
});

test("computeAntiBandRate returns 1.0 when all top-k results are anti-bands", () => {
  const antiBands = ["Imagine Dragons", "Coldplay"];
  const results = ["Imagine Dragons", "Coldplay"];
  assert.equal(computeAntiBandRate(antiBands, results, 8), 1.0);
});

test("computeAntiBandRate returns partial rate", () => {
  const antiBands = ["Imagine Dragons"];
  const results = ["Imagine Dragons", "Alcest", "Fen", "Les Discrets"];
  assert.equal(computeAntiBandRate(antiBands, results, 4), 0.25);
});

test("computeAntiBandRate only considers top-k results", () => {
  const antiBands = ["Imagine Dragons"];
  const results = ["Alcest", "Fen", "Imagine Dragons"];
  // k=2: only Alcest and Fen — no anti-bands
  assert.equal(computeAntiBandRate(antiBands, results, 2), 0);
});

test("computeAntiBandRate returns 0 for empty results", () => {
  assert.equal(computeAntiBandRate(["Imagine Dragons"], [], 8), 0);
});

// ─── normalizeTerm ────────────────────────────────────────────────────────────

test("normalizeTerm folds case, hyphens and punctuation to a common form", () => {
  assert.equal(normalizeTerm("Post-Black Metal"), "post black metal");
  assert.equal(normalizeTerm("post black metal"), "post black metal");
  assert.equal(normalizeTerm("  Lo-Fi / Raw  "), "lo fi raw");
});

// ─── computeNuggetCoverage ────────────────────────────────────────────────────

test("computeNuggetCoverage returns 1.0 when every nugget appears in some band's tags", () => {
  const nuggets = ["atmospheric black metal", "shoegaze"];
  const tagSets = [["atmospheric black metal", "france"], ["shoegaze", "dream pop"]];
  assert.equal(computeNuggetCoverage(nuggets, tagSets, 8), 1.0);
});

test("computeNuggetCoverage returns 0 when no tag covers any nugget", () => {
  const nuggets = ["dark ambient", "drone"];
  const tagSets = [["pop rock"], ["britpop", "alternative rock"]];
  assert.equal(computeNuggetCoverage(nuggets, tagSets, 8), 0);
});

test("computeNuggetCoverage returns partial coverage", () => {
  const nuggets = ["doom metal", "funeral doom", "death-doom"];
  const tagSets = [["doom metal", "funeral doom"], ["sludge metal"]];
  const actual = computeNuggetCoverage(nuggets, tagSets, 8);
  assert.ok(Math.abs(actual - 2 / 3) < 0.001, `expected ~0.667 but got ${actual}`);
});

test("computeNuggetCoverage matches across hyphenation and case differences", () => {
  // MusicBrainz spells the same genre both ways across artists.
  assert.equal(computeNuggetCoverage(["post-black metal"], [["Post Black Metal"]], 8), 1.0);
  assert.equal(computeNuggetCoverage(["death-doom"], [["death doom metal"]], 8), 1.0);
});

test("computeNuggetCoverage counts a nugget covered by a more specific tag", () => {
  // Post-black metal is black metal, so it satisfies the broader nugget.
  assert.equal(computeNuggetCoverage(["black metal"], [["post-black metal"]], 8), 1.0);
});

test("computeNuggetCoverage does not let a broader tag satisfy a specific nugget", () => {
  // The reverse must not hold: a plain black metal band has not covered the
  // "post-black metal" sonic space. This is the loose match that would let the
  // pipeline score well by naming merely genre-adjacent bands.
  assert.equal(computeNuggetCoverage(["post-black metal"], [["black metal"]], 8), 0);
});

test("computeNuggetCoverage does not match on partial words", () => {
  // "gaze" is a substring of "blackgaze" but not a whole-word match.
  assert.equal(computeNuggetCoverage(["shoegaze"], [["blackgaze"]], 8), 0);
});

test("computeNuggetCoverage pools tags across bands", () => {
  // One band per nugget is enough — the metric asks whether the response as a
  // whole covered the space, not whether every band did.
  const nuggets = ["folk metal", "viking metal"];
  const tagSets = [["folk metal"], ["viking metal"]];
  assert.equal(computeNuggetCoverage(nuggets, tagSets, 8), 1.0);
});

test("computeNuggetCoverage only considers top-k results", () => {
  const nuggets = ["dark ambient"];
  const tagSets = [["pop"], ["rock"], ["dark ambient"]];
  assert.equal(computeNuggetCoverage(nuggets, tagSets, 2), 0);
});

test("computeNuggetCoverage tolerates bands with no tags", () => {
  assert.equal(computeNuggetCoverage(["drone"], [[], ["drone", "doom metal"]], 8), 1.0);
});

test("computeNuggetCoverage returns 0 for empty results", () => {
  assert.equal(computeNuggetCoverage(["dark ambient"], [], 8), 0);
});

test("computeNuggetCoverage returns 0 for empty nuggets", () => {
  assert.equal(computeNuggetCoverage([], [["dark ambient"]], 8), 0);
});

// ─── findUncoveredNuggets ─────────────────────────────────────────────────────

test("findUncoveredNuggets names the nuggets that no tag covered", () => {
  const nuggets = ["doom metal", "funeral doom", "death-doom"];
  const tagSets = [["doom metal"], ["sludge metal"]];
  assert.deepEqual(findUncoveredNuggets(nuggets, tagSets, 8), ["funeral doom", "death-doom"]);
});

// ─── createTagResolver ────────────────────────────────────────────────────────

test("createTagResolver merges tags and genres", async () => {
  const resolver = createTagResolver(
    {
      async lookupArtist() {
        return { id: "m", name: "X", tags: ["shoegaze"], genres: ["black metal"], urls: [], lifeSpan: { ended: false } };
      },
    },
    0,
  );
  assert.deepEqual(await resolver.resolve("mbid-1"), ["shoegaze", "black metal"]);
});

test("createTagResolver looks up each mbid only once", async () => {
  let calls = 0;
  const resolver = createTagResolver(
    {
      async lookupArtist() {
        calls += 1;
        return { id: "m", name: "X", tags: ["drone"], genres: [], urls: [], lifeSpan: { ended: false } };
      },
    },
    0,
  );
  await Promise.all([resolver.resolve("mbid-1"), resolver.resolve("mbid-1"), resolver.resolve("mbid-1")]);
  assert.equal(calls, 1);
});

test("createTagResolver returns null when the lookup fails", async () => {
  const resolver = createTagResolver(
    {
      async lookupArtist(): Promise<never> {
        throw new Error("musicbrainz request failed with status 503");
      },
    },
    0,
  );
  // null is distinct from []: it means "unknown", so the runner can warn rather
  // than silently scoring the band as covering nothing.
  assert.equal(await resolver.resolve("mbid-1"), null);
});

test("createTagResolver survives a failure and keeps serving later lookups", async () => {
  let first = true;
  const resolver = createTagResolver(
    {
      async lookupArtist() {
        if (first) {
          first = false;
          throw new Error("boom");
        }
        return { id: "m", name: "X", tags: ["ambient"], genres: [], urls: [], lifeSpan: { ended: false } };
      },
    },
    0,
  );
  assert.equal(await resolver.resolve("mbid-1"), null);
  assert.deepEqual(await resolver.resolve("mbid-2"), ["ambient"]);
});

test("createTagResolver spaces requests by the throttle interval", async () => {
  const startedAt: number[] = [];
  const resolver = createTagResolver(
    {
      async lookupArtist() {
        startedAt.push(Date.now());
        return { id: "m", name: "X", tags: [], genres: [], urls: [], lifeSpan: { ended: false } };
      },
    },
    40,
  );
  await Promise.all([resolver.resolve("a"), resolver.resolve("b"), resolver.resolve("c")]);
  assert.equal(startedAt.length, 3);
  assert.ok(startedAt[1] - startedAt[0] >= 35, `gap 1 too small: ${startedAt[1] - startedAt[0]}ms`);
  assert.ok(startedAt[2] - startedAt[1] >= 35, `gap 2 too small: ${startedAt[2] - startedAt[1]}ms`);
});

test("runGoldenEntriesSequentially does not start the next entry until the previous finishes", async () => {
  const events: string[] = [];
  const results = await runGoldenEntriesSequentially(
    [{ id: "a", query: "q1" }, { id: "b", query: "q2" }],
    async (entry) => {
      events.push(`start:${entry.id}`);
      await new Promise((r) => setTimeout(r, 30));
      events.push(`end:${entry.id}`);
      return {
        id: entry.id,
        query: entry.query,
        status: "pass",
        resultNames: [],
        antiBandRateAt8: 0,
        nuggetCoverageAt8: 0,
        uncoveredNuggets: [],
        passed: true,
        warnings: [],
        latencyMs: 30,
        model: null,
        pipelineVersion: null,
        replay: false,
        tagSources: { musicbrainz: 0, lastfm: 0, none: 0 },
      };
    },
  );
  assert.deepEqual(events, ["start:a", "end:a", "start:b", "end:b"]);
  assert.equal(results.length, 2);
});

test("MB_POST_RECOMMENDATION_COOLDOWN_MS leaves at least one MusicBrainz IP interval", () => {
  assert.ok(MB_POST_RECOMMENDATION_COOLDOWN_MS >= 1100);
});

// ─── runGoldenEntry: what one query records ──────────────────────────────────

function apiReturning(body: unknown, status = 200): { fetchImpl: typeof fetch; requests: Request[] } {
  const requests: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const noTags = { tagsFor: async () => ({ tags: ["post-black metal"], source: "musicbrainz" as const }) };

test("a golden query records the model and pipeline version the API reported", async () => {
  const { fetchImpl } = apiReturning({
    recommendations: [{ artist: "Fen", musicbrainzArtistId: "mbid-fen" }],
    meta: { model: "gemma-4-26b-a4b-it", pipelineVersion: "0.4.0" },
  });

  const result = await runGoldenEntry(
    "http://api.test",
    { id: "blackgaze", query: "bands like Alcest", nuggets: ["black metal"] },
    noTags,
    { fetchImpl, mbCooldownMs: 0 },
  );

  assert.equal(result.status, "pass");
  assert.equal(result.model, "gemma-4-26b-a4b-it");
  assert.equal(result.pipelineVersion, "0.4.0");
  assert.equal(typeof result.latencyMs, "number");
});

test("a golden query measures the API call, not the MusicBrainz lookups after it", async () => {
  let clock = 0;
  const { fetchImpl } = apiReturning({ recommendations: [{ artist: "Fen", musicbrainzArtistId: "m" }], meta: {} });
  const slowTags = {
    tagsFor: async () => {
      clock += 5000;
      return { tags: ["drone"], source: "musicbrainz" as const };
    },
  };

  const result = await runGoldenEntry("http://api.test", { id: "x", query: "q" }, slowTags, {
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      clock += 1200;
      return fetchImpl(input, init);
    }) as typeof fetch,
    mbCooldownMs: 0,
    now: () => clock,
  });

  assert.equal(result.latencyMs, 1200);
});

test("a golden query sends the API token when one is configured", async () => {
  const { fetchImpl, requests } = apiReturning({ recommendations: [], meta: {} });

  await runGoldenEntry("http://api.test", { id: "x", query: "q" }, noTags, {
    fetchImpl,
    mbCooldownMs: 0,
    apiToken: "tok-123",
  });

  assert.equal(requests[0]!.headers.get("authorization"), "Bearer tok-123");
});

test("a golden query against a failing API throws, for the runner to record as an error", async () => {
  const { fetchImpl } = apiReturning({ error: { code: "bad_gateway" } }, 502);
  await assert.rejects(
    runGoldenEntry("http://api.test", { id: "x", query: "q" }, noTags, { fetchImpl, mbCooldownMs: 0 }),
    /API error 502/,
  );
});

test("one failing query does not stop the golden run", async () => {
  const results = await runGoldenEntriesSequentially(
    [{ id: "a", query: "q1" }, { id: "b", query: "q2", nuggets: ["drone"] }, { id: "c", query: "q3" }],
    async (entry): Promise<GoldenResult> => {
      if (entry.id === "b") throw new Error("API error 502 for query \"q2\"");
      return { ...goldenErrorResult(entry, "unused"), status: "pass", passed: true, warnings: [] };
    },
    { onError: goldenErrorResult },
  );

  assert.deepEqual(results.map((r) => r.status), ["pass", "error", "pass"]);
  const failed = results[1]!;
  assert.equal(failed.passed, false);
  assert.match(failed.error ?? "", /API error 502/);
  assert.deepEqual(failed.uncoveredNuggets, ["drone"]);
});

test("a query whose bands have no MusicBrainz tags has unknown coverage, not zero", async () => {
  const { fetchImpl } = apiReturning({
    recommendations: [{ artist: "Obscure Act", musicbrainzArtistId: "mbid-x" }],
    meta: { model: "m" },
  });
  const untagged = { tagsFor: async () => ({ tags: [] as string[], source: null }) };

  const result = await runGoldenEntry(
    "http://api.test",
    { id: "x", query: "q", nuggets: ["funeral doom"] },
    untagged,
    { fetchImpl, mbCooldownMs: 0 },
  );

  assert.equal(result.nuggetCoverageAt8, null);
  assert.equal(result.status, "pass", "the anti-band gate still decides pass/fail");
});

// ─── tag lookup: MusicBrainz first, Last.fm for the rest (#250) ──────────────

function mbResolver(tagsByMbid: Record<string, string[] | null>) {
  return { resolve: async (mbid: string) => (mbid in tagsByMbid ? tagsByMbid[mbid]! : []) };
}
function lastFm(tagsByName: Record<string, Array<{ name: string; count: number }> | null>, asked: string[] = []) {
  return {
    getTopTags: async (name: string) => {
      asked.push(name);
      return name in tagsByName ? tagsByName[name]! : [];
    },
  };
}

test("a band's MusicBrainz tags are used when it has them, without asking Last.fm", async () => {
  const asked: string[] = [];
  const lookup = createTagLookup({ musicBrainz: mbResolver({ m1: ["blackgaze"] }), lastFm: lastFm({}, asked) });

  assert.deepEqual(await lookup.tagsFor({ artist: "Fen", musicbrainzArtistId: "m1" }), { tags: ["blackgaze"], source: "musicbrainz" });
  assert.deepEqual(asked, []);
});

test("a band without MusicBrainz tags gets its Last.fm tags, minus the weakly weighted ones", async () => {
  const lookup = createTagLookup({
    musicBrainz: mbResolver({ m1: [] }),
    lastFm: lastFm({ Fen: [{ name: "post-black metal", count: 100 }, { name: "seen live", count: 4 }] }),
  });

  assert.deepEqual(await lookup.tagsFor({ artist: "Fen", musicbrainzArtistId: "m1" }), {
    tags: ["post-black metal"],
    source: "lastfm",
  });
});

test("a band with no MusicBrainz id is looked up on Last.fm by name", async () => {
  const lookup = createTagLookup({ musicBrainz: mbResolver({}), lastFm: lastFm({ Sylvaine: [{ name: "shoegaze", count: 80 }] }) });
  assert.deepEqual(await lookup.tagsFor({ artist: "Sylvaine" }), { tags: ["shoegaze"], source: "lastfm" });
});

test("when both sources fail the band's tags are unknown, not empty", async () => {
  const lookup = createTagLookup({ musicBrainz: mbResolver({ m1: null }), lastFm: lastFm({ Fen: null }) });
  assert.equal(await lookup.tagsFor({ artist: "Fen", musicbrainzArtistId: "m1" }), null);
});

test("without a Last.fm key, MusicBrainz alone decides", async () => {
  const lookup = createTagLookup({ musicBrainz: mbResolver({ m1: [] }) });
  assert.deepEqual(await lookup.tagsFor({ artist: "Fen", musicbrainzArtistId: "m1" }), { tags: [], source: null });
});

test("a golden query records where its bands' tags came from and whether the API replayed", async () => {
  const { fetchImpl } = apiReturning({
    recommendations: [
      { artist: "Fen", musicbrainzArtistId: "m1" },
      { artist: "Sylvaine", musicbrainzArtistId: "m2" },
      { artist: "Obscure", musicbrainzArtistId: "m3" },
    ],
    meta: { model: "m", evalReplay: true },
  });
  const lookup = createTagLookup({
    musicBrainz: mbResolver({ m1: ["post-black metal"], m2: [], m3: [] }),
    lastFm: lastFm({ Sylvaine: [{ name: "blackgaze", count: 90 }] }),
  });

  const result = await runGoldenEntry(
    "http://api.test",
    { id: "x", query: "q", nuggets: ["black metal", "blackgaze"] },
    lookup,
    { fetchImpl, mbCooldownMs: 0 },
  );

  assert.deepEqual(result.tagSources, { musicbrainz: 1, lastfm: 1, none: 1 });
  assert.equal(result.nuggetCoverageAt8, 1, "Last.fm's blackgaze covers the second nugget");
  assert.equal(result.replay, true);
});
