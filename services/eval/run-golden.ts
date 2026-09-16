import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createMusicBrainzClient } from "../api/src/integrations/musicbrainz.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_MIN_NUGGET_COVERAGE = 0.5;
/** Must outlast RESEARCH_TIMEOUT_MS (default 180s) plus HTTP overhead. */
const DEFAULT_RECOMMENDATION_FETCH_TIMEOUT_MS = 200_000;
/**
 * Pause after /recommendations before eval tag lookups. The API and the runner
 * share one public IP; MusicBrainz 503s the whole IP if we keep firing above
 * ~1 req/s. One interval lets the API's last verify call clear the window.
 */
export const MB_POST_RECOMMENDATION_COOLDOWN_MS = 1200;

export type GoldenEntry = {
  id: string;
  query: string;
  obscurityTarget?: string;
  /** Atomic sonic properties (genre, era, trait) the response should cover. */
  nuggets?: string[];
  /**
   * Bands that are unambiguously wrong for this query — too well known for the
   * obscurity target, or plainly off-genre. There is deliberately no
   * `expectedBands` counterpart: over an open-ended search of all recorded
   * music, "these specific bands should appear" is not a claim we can defend,
   * whereas "this stadium act must not" is.
   */
  antiBands?: string[];
  minNuggetCoverage?: number;
  notes?: string;
};

export type Recommendation = {
  artist: string;
  musicbrainzArtistId?: string;
};

export type GoldenResult = {
  id: string;
  query: string;
  resultNames: string[];
  antiBandRateAt8: number;
  nuggetCoverageAt8: number;
  uncoveredNuggets: string[];
  passed: boolean;
  warnings: string[];
};

// `precision@8` used to live here. It was designed (see
// docs/architecture/2026-05-29-eval-architecture.md) to score an `expectedBands`
// list, but that field was never added to GoldenEntry, so the call passed
// `nuggets` instead — and since it divided hits by the size of the reference set
// rather than by k, it computed recall@k under a precision name and returned the
// exact same number as nuggetCoverage@8. Two names, one metric.
//
// Dividing by k instead would not rescue it: with three nuggets and k=8, true
// precision@8 caps at 0.375, so the 0.5 warning threshold could never be met.
// The design doc already argues that exact-match precision is the wrong shape
// for open-ended retrieval, so the duplicate is removed rather than repaired.

export function computeAntiBandRate(antiBands: string[], results: string[], k: number): number {
  if (results.length === 0) return 0;
  const topK = results.slice(0, k);
  if (topK.length === 0) return 0;
  const normalizedAnti = new Set(antiBands.map((n) => n.toLowerCase()));
  const hits = topK.filter((r) => normalizedAnti.has(r.toLowerCase())).length;
  return hits / topK.length;
}

/**
 * Fold a genre string into a comparable form: lowercase, punctuation and
 * hyphens flattened to spaces, whitespace collapsed. "Post-Black Metal" and
 * "post black metal" have to land on the same string, because MusicBrainz
 * spells the same genre both ways across artists.
 */
export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A nugget is covered when some tag *contains* it on whole-word boundaries —
 * deliberately one-directional. A band tagged "post-black metal" covers the
 * nugget "black metal", because post-black metal is black metal. The reverse
 * must not hold: a plain "black metal" tag cannot satisfy a "post-black metal"
 * nugget, which is exactly the loose match that would let the pipeline score
 * well by naming genre-adjacent bands.
 */
function nuggetIsCovered(nugget: string, normalizedTags: string[]): boolean {
  const needle = ` ${normalizeTerm(nugget)} `;
  if (needle.trim() === "") return false;
  return normalizedTags.some((tag) => ` ${tag} `.includes(needle));
}

/**
 * Fraction of `nuggets` covered by the MusicBrainz tags/genres of the top-k
 * recommendations. `tagSets[i]` holds the merged tags+genres of result i, so a
 * nugget only has to be covered by *one* band to count — the metric asks
 * whether the response as a whole covered the sonic space, not whether every
 * band did.
 */
export function computeNuggetCoverage(nuggets: string[], tagSets: string[][], k: number): number {
  return nuggets.length === 0 ? 0 : 1 - findUncoveredNuggets(nuggets, tagSets, k).length / nuggets.length;
}

export function findUncoveredNuggets(nuggets: string[], tagSets: string[][], k: number): string[] {
  const normalizedTags = tagSets
    .slice(0, k)
    .flat()
    .map(normalizeTerm)
    .filter((t) => t !== "");
  return nuggets.filter((n) => !nuggetIsCovered(n, normalizedTags));
}

/**
 * Serialize calls and space them at least `minIntervalMs` apart.
 * MusicBrainz's IP rule is ~1 req/s average — burst above that and every
 * request is 503'd until the rate drops.
 */
function createThrottle(minIntervalMs: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve();
  let lastStart = 0;
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = lastStart + minIntervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run as Promise<T>;
  };
}

export type TagResolver = {
  resolve: (mbid: string) => Promise<string[] | null>;
};

/**
 * Throttled, memoized "mbid → tags+genres" lookup. `null` means MB failed.
 * Prefer relying on `createMusicBrainzClient`'s process-wide gate for live
 * traffic (`minIntervalMs: 0` here); keep a positive interval when the client
 * is a stub that does not throttle.
 */
export function createTagResolver(
  client: Pick<ReturnType<typeof createMusicBrainzClient>, "lookupArtist">,
  minIntervalMs: number = 0,
): TagResolver {
  const cache = new Map<string, Promise<string[] | null>>();
  const throttle = createThrottle(minIntervalMs);
  return {
    resolve(mbid: string) {
      const cached = cache.get(mbid);
      if (cached) return cached;
      const pending = throttle(async () => {
        try {
          const artist = await client.lookupArtist(mbid);
          return [...artist.tags, ...artist.genres];
        } catch {
          return null;
        }
      });
      cache.set(mbid, pending);
      return pending;
    },
  };
}

/** Run golden entries one-at-a-time so the API's MB verifications don't pile up. */
export async function runGoldenEntriesSequentially(
  entries: GoldenEntry[],
  runOne: (entry: GoldenEntry) => Promise<GoldenResult>,
): Promise<GoldenResult[]> {
  const results: GoldenResult[] = [];
  for (const entry of entries) {
    results.push(await runOne(entry));
  }
  return results;
}

async function fetchRecommendations(
  apiUrl: string,
  query: string,
  obscurityTarget?: string,
  timeoutMs: number = DEFAULT_RECOMMENDATION_FETCH_TIMEOUT_MS,
): Promise<Recommendation[]> {
  const body: Record<string, unknown> = { query };
  if (obscurityTarget) body.obscurityTarget = obscurityTarget;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/recommendations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`API error ${response.status} for query "${query}"`);
  }

  const data = (await response.json()) as {
    recommendations?: Array<{ artist?: string; musicbrainzArtistId?: string }>;
  };
  return (data.recommendations ?? [])
    .map((r) => ({ artist: r.artist ?? "", musicbrainzArtistId: r.musicbrainzArtistId }))
    .filter((r) => r.artist.length > 0);
}

async function runGoldenEntry(
  apiUrl: string,
  entry: GoldenEntry,
  tags: TagResolver,
  k = 8,
  options: { mbCooldownMs?: number } = {},
): Promise<GoldenResult> {
  const recommendations = await fetchRecommendations(apiUrl, entry.query, entry.obscurityTarget);
  const resultNames = recommendations.map((r) => r.artist);
  const nuggets = entry.nuggets ?? [];
  const antiBands = entry.antiBands ?? [];
  const minCoverage = entry.minNuggetCoverage ?? DEFAULT_MIN_NUGGET_COVERAGE;
  const warnings: string[] = [];

  const topK = recommendations.slice(0, k);
  const needsMbLookup = topK.some((r) => r.musicbrainzArtistId);
  const cooldownMs = options.mbCooldownMs ?? MB_POST_RECOMMENDATION_COOLDOWN_MS;
  if (needsMbLookup && cooldownMs > 0) {
    await new Promise((r) => setTimeout(r, cooldownMs));
  }

  const resolved = await Promise.all(
    topK.map((r) => (r.musicbrainzArtistId ? tags.resolve(r.musicbrainzArtistId) : Promise.resolve([] as string[]))),
  );
  const tagSets = resolved.map((t) => t ?? []);

  const unidentified = topK.filter((r) => !r.musicbrainzArtistId).length;
  if (unidentified > 0) {
    warnings.push(`${unidentified} of ${topK.length} top-8 results have no musicbrainzArtistId`);
  }
  const lookupFailures = resolved.filter((t) => t === null).length;
  if (lookupFailures > 0) {
    warnings.push(`${lookupFailures} MusicBrainz lookup(s) failed — coverage may understate quality`);
  }

  const antiBandRateAt8 = computeAntiBandRate(antiBands, resultNames, k);
  const nuggetCoverageAt8 = computeNuggetCoverage(nuggets, tagSets, k);
  const uncoveredNuggets = findUncoveredNuggets(nuggets, tagSets, k);

  // If no top-8 band yielded any tags at all, coverage is measuring MusicBrainz
  // availability rather than recommendation quality. Report it, don't gate on it.
  const tagsUsable = tagSets.some((t) => t.length > 0);
  const coverageGateApplies = nuggets.length > 0 && tagsUsable;
  if (nuggets.length > 0 && !tagsUsable) {
    warnings.push("no MusicBrainz tags available for any top-8 result — coverage gate skipped");
  }
  if (coverageGateApplies && nuggetCoverageAt8 < minCoverage) {
    warnings.push(`uncovered nuggets: ${uncoveredNuggets.join(", ")}`);
  }

  const passed =
    antiBandRateAt8 <= 0.5 && (!coverageGateApplies || nuggetCoverageAt8 >= minCoverage);

  return {
    id: entry.id,
    query: entry.query,
    resultNames,
    antiBandRateAt8,
    nuggetCoverageAt8,
    uncoveredNuggets,
    passed,
    warnings,
  };
}

function printTable(results: GoldenResult[]): void {
  console.log("\n=== Golden Dataset Results ===\n");
  for (const r of results) {
    const status = r.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`${status}  ${r.id}`);
    console.log(`  Query:       ${r.query}`);
    console.log(`  Results:     ${r.resultNames.slice(0, 5).join(", ")}${r.resultNames.length > 5 ? "…" : ""}`);
    console.log(`  AntiBand@8:  ${(r.antiBandRateAt8 * 100).toFixed(0)}%`);
    console.log(`  Nugget@8:    ${(r.nuggetCoverageAt8 * 100).toFixed(0)}%`);
    for (const w of r.warnings) {
      console.log(`  ⚠  ${w}`);
    }
    console.log();
  }
}

async function main(): Promise<void> {
  const apiUrl = process.env.BANDSEARCH_API_URL ?? "http://localhost:3001";
  const strict = process.argv.includes("--strict");

  const goldenSet: GoldenEntry[] = JSON.parse(
    readFileSync(join(__dirname, "golden-set.json"), "utf8"),
  );

  console.log(`Running ${goldenSet.length} golden queries against ${apiUrl}`);

  // BANDSEARCH_MB_BASE_URL points the tag lookups at a stub, so the runner can
  // be exercised end-to-end without depending on MusicBrainz being up.
  // Live traffic: spacing lives in createMusicBrainzClient (process-wide 1.1s).
  // Stub: disable client throttle; tag resolver also unthrottled.
  const mbBaseUrl = process.env.BANDSEARCH_MB_BASE_URL;
  const tags = createTagResolver(
    createMusicBrainzClient(
      mbBaseUrl ? { baseUrl: mbBaseUrl, minIntervalMs: 0 } : {},
    ),
    0,
  );
  const results = await runGoldenEntriesSequentially(goldenSet, (entry) =>
    runGoldenEntry(apiUrl, entry, tags),
  );

  printTable(results);

  const warnCount = results.reduce((n, r) => n + r.warnings.length, 0);
  if (warnCount > 0) {
    console.log(`${warnCount} warning(s) — see above`);
  }

  if (strict) {
    const strictFailed = results.filter((r) => r.antiBandRateAt8 > 0);
    if (strictFailed.length > 0) {
      console.error(`\n[--strict] ${strictFailed.length} query(ies) have anti-bands in top-8`);
      process.exit(1);
    }
  }

  const antiBandFailures = results.filter((r) => r.antiBandRateAt8 > 0.5);
  const coverageFailures = results.filter((r) => !r.passed && r.antiBandRateAt8 <= 0.5);

  if (antiBandFailures.length > 0) {
    console.error(`\n${antiBandFailures.length} query(ies) failed the anti-band gate (rate > 50%)`);
  }
  if (coverageFailures.length > 0) {
    console.error(`${coverageFailures.length} query(ies) fell below their minNuggetCoverage`);
  }
  if (antiBandFailures.length > 0 || coverageFailures.length > 0) {
    process.exit(1);
  }

  console.log("All queries passed.");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
