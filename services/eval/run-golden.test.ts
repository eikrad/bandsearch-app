import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAntiBandRate,
  computeNuggetCoverage,
  createTagResolver,
  findUncoveredNuggets,
  MB_POST_RECOMMENDATION_COOLDOWN_MS,
  normalizeTerm,
  runGoldenEntriesSequentially,
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
        resultNames: [],
        antiBandRateAt8: 0,
        nuggetCoverageAt8: 0,
        uncoveredNuggets: [],
        passed: true,
        warnings: [],
      };
    },
  );
  assert.deepEqual(events, ["start:a", "end:a", "start:b", "end:b"]);
  assert.equal(results.length, 2);
});

test("MB_POST_RECOMMENDATION_COOLDOWN_MS leaves at least one MusicBrainz IP interval", () => {
  assert.ok(MB_POST_RECOMMENDATION_COOLDOWN_MS >= 1100);
});
