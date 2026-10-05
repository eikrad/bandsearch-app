import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { config as loadEnv } from "dotenv";

import type { ChatModelClient } from "../api/src/agent/modelUtils.js";
import { modelFamily } from "../api/src/config/models.js";
import { createChatModelFactory } from "../api/src/llm/chatModel.js";
import { checkEvidence } from "../api/src/eval/evidenceChecker.js";
import { createLastFmClient } from "../api/src/eval/lastFmClient.js";
import { classifyObscurityTier } from "../api/src/eval/obscurityScorer.js";
import type { JudgeInput } from "../api/src/eval/judgeWorker.js";
import { createMusicBrainzClient } from "../api/src/integrations/musicbrainz.js";
import { createReplayFetch } from "../api/src/integrations/replayFetch.js";
import { writeDashboard } from "./dashboard.ts";
import { createConstraintChecker, constraintRate, type ConstraintCheck, type GoldenConstraints } from "./constraints.ts";
import { appendRun, buildGoldenRunRecord, readGitState, type GoldenJudgeConfig } from "./history.ts";
import { judgeWithVotes, type NumericScores } from "./judging.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_MIN_NUGGET_COVERAGE = 0.5;
const DEFAULT_MIN_CONSTRAINT_RATE = 0.75;

export type JudgeMeans = {
  relevance: number | null;
  obscurityFit: number | null;
  evidenceQuality: number | null;
  discoveryValue: number | null;
};

/**
 * The checks a golden query can fail: no band at all, too many anti-bands, too
 * little coverage, constraints missed.
 */
export type GoldenGate = "noResults" | "antiBand" | "coverage" | "constraint";
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
  /** Hard facts every recommended band must meet, checked against MusicBrainz (#253). */
  constraints?: GoldenConstraints;
  /** Share of decided top bands that must meet the constraints; default 0.75. */
  minConstraintRate?: number;
  notes?: string;
};

export type Recommendation = {
  artist: string;
  musicbrainzArtistId?: string;
  why?: string;
  sourceSignals?: string[];
};

export type GoldenResult = {
  id: string;
  query: string;
  /**
   * `error` means the runner got no answer to score (HTTP error, timeout); its
   * metrics are placeholders and the history leaves them out of every mean.
   */
  status: "pass" | "fail" | "error";
  resultNames: string[];
  antiBandRateAt8: number;
  /**
   * Null when coverage cannot be known: the entry has no nuggets, or no top-8
   * band has any MusicBrainz tags. Unknown is not zero — counting it as zero
   * would let tag availability pose as recommendation quality.
   */
  nuggetCoverageAt8: number | null;
  uncoveredNuggets: string[];
  passed: boolean;
  warnings: string[];
  /** Wall time of the /recommendations call alone; null when it failed. */
  latencyMs: number | null;
  /** Model the API reported in `meta.model`; null if it reported none. */
  model: string | null;
  pipelineVersion: string | null;
  /** Whether the API replayed recorded lookups (meta.evalReplay); null when it gave no answer. */
  replay: boolean | null;
  /** Where the top bands' tags came from; `none` counts bands with no tags or failed lookups. */
  tagSources: { musicbrainz: number; lastfm: number; none: number };
  /** Share of decided top bands meeting every constraint; null without constraints or decidable bands. */
  constraintRateAt8: number | null;
  constraintVerdicts: { met: number; missed: number; unknown: number } | null;
  /** Which checks failed; empty when the query passed or got no answer. */
  failedGates: GoldenGate[];
  /** The judge's mean scores over the top bands; null when not judged or the judge failed. */
  judgeScores: JudgeMeans | null;
  error?: string;
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

export type TagSource = "musicbrainz" | "lastfm";
export type BandTags = { tags: string[]; source: TagSource | null };

/** Tags for one recommended band; null when every source failed (unknown, not "no tags"). */
export type TagLookup = { tagsFor(rec: Recommendation): Promise<BandTags | null> };

/**
 * Last.fm weights tags 0–100 relative to the artist's top tag. Below this,
 * tags are mostly listener noise ("seen live", "favorites") rather than genre.
 */
export const MIN_LASTFM_TAG_WEIGHT = 10;

/**
 * MusicBrainz first, Last.fm for bands MusicBrainz has no tags for. Obscure
 * bands often have no MusicBrainz tags at all, which left coverage unknown for
 * 4–6 of 10 golden queries; Last.fm's listener tags reach far more of them.
 */
export function createTagLookup({
  musicBrainz,
  lastFm,
}: {
  musicBrainz: TagResolver;
  lastFm?: { getTopTags(artistName: string, mbid?: string): Promise<Array<{ name: string; count: number }> | null> };
}): TagLookup {
  return {
    async tagsFor(rec) {
      const fromMb = rec.musicbrainzArtistId ? await musicBrainz.resolve(rec.musicbrainzArtistId) : [];
      if (fromMb && fromMb.length > 0) return { tags: fromMb, source: "musicbrainz" };
      if (!lastFm) return fromMb === null ? null : { tags: [], source: null };

      const fromLastFm = await lastFm.getTopTags(rec.artist, rec.musicbrainzArtistId);
      if (fromLastFm === null) return fromMb === null ? null : { tags: [], source: null };
      const tags = fromLastFm.filter((t) => t.count >= MIN_LASTFM_TAG_WEIGHT).map((t) => t.name);
      return tags.length > 0 ? { tags, source: "lastfm" } : { tags: [], source: null };
    },
  };
}

/**
 * Tags and constraints both read an artist's MusicBrainz record; one lookup per
 * artist per run keeps the 1 req/s budget for new artists.
 */
function memoizeArtistLookups<C extends ReturnType<typeof createMusicBrainzClient>>(client: C): C {
  const artists = new Map<string, ReturnType<C["lookupArtist"]>>();
  const members = new Map<string, ReturnType<C["lookupBandMembers"]>>();
  return {
    ...client,
    lookupArtist: (mbid: string) => {
      if (!artists.has(mbid)) artists.set(mbid, client.lookupArtist(mbid) as ReturnType<C["lookupArtist"]>);
      return artists.get(mbid)!;
    },
    lookupBandMembers: (mbid: string) => {
      if (!members.has(mbid)) members.set(mbid, client.lookupBandMembers(mbid) as ReturnType<C["lookupBandMembers"]>);
      return members.get(mbid)!;
    },
  };
}

/** Run golden entries one-at-a-time so the API's MB verifications don't pile up. */
export async function runGoldenEntriesSequentially(
  entries: GoldenEntry[],
  runOne: (entry: GoldenEntry) => Promise<GoldenResult>,
  options: { onError?: (entry: GoldenEntry, err: unknown) => GoldenResult; pauseMs?: number } = {},
): Promise<GoldenResult[]> {
  const results: GoldenResult[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    try {
      results.push(await runOne(entry));
    } catch (err) {
      if (!options.onError) throw err;
      results.push(options.onError(entry, err));
    }
    if (options.pauseMs && options.pauseMs > 0 && i < entries.length - 1) {
      await new Promise((r) => setTimeout(r, options.pauseMs));
    }
  }
  return results;
}

type RecommendationsResponse = {
  recommendations: Recommendation[];
  model: string | null;
  pipelineVersion: string | null;
  replay: boolean;
};

async function fetchRecommendations(
  apiUrl: string,
  query: string,
  obscurityTarget: string | undefined,
  { fetchImpl = globalThis.fetch, apiToken, timeoutMs = DEFAULT_RECOMMENDATION_FETCH_TIMEOUT_MS }: {
    fetchImpl?: typeof fetch;
    apiToken?: string;
    timeoutMs?: number;
  } = {},
): Promise<RecommendationsResponse> {
  const body: Record<string, unknown> = { query };
  if (obscurityTarget) body.obscurityTarget = obscurityTarget;

  const headers: Record<string, string> = { "content-type": "application/json" };
  // A deployment with more than one account rejects anonymous requests.
  if (apiToken) headers.authorization = `Bearer ${apiToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/recommendations`, {
      method: "POST",
      headers,
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
    recommendations?: Array<{ artist?: string; musicbrainzArtistId?: string; why?: unknown; sourceSignals?: unknown }>;
    meta?: { model?: unknown; pipelineVersion?: unknown; evalReplay?: unknown };
  };
  return {
    recommendations: (data.recommendations ?? [])
      .map((r) => ({
        artist: r.artist ?? "",
        musicbrainzArtistId: r.musicbrainzArtistId,
        why: typeof r.why === "string" ? r.why : undefined,
        sourceSignals: Array.isArray(r.sourceSignals) ? r.sourceSignals.filter((x): x is string => typeof x === "string") : undefined,
      }))
      .filter((r) => r.artist.length > 0),
    model: typeof data.meta?.model === "string" ? data.meta.model : null,
    pipelineVersion: typeof data.meta?.pipelineVersion === "string" ? data.meta.pipelineVersion : null,
    replay: data.meta?.evalReplay === true,
  };
}

export type RunGoldenEntryOptions = {
  k?: number;
  mbCooldownMs?: number;
  fetchImpl?: typeof fetch;
  apiToken?: string;
  /** Clock for the latency measurement; injectable so tests need not sleep. */
  now?: () => number;
  /**
   * Scores the top bands with an LLM judge, given what the live judge gets.
   * Not a gate: judge scores measure quality, they do not pass or fail a query.
   */
  judge?: {
    model: ChatModelClient;
    modelId: string;
    votes?: number;
    /** Last.fm listener count per band, for the obscurity tier; omit to send none. */
    listenersOf?: (artist: string) => Promise<number | null>;
  };
  /** Checks bands against an entry's constraints; required when the entry has any. */
  constraintChecker?: {
    check(rec: Recommendation, constraints: GoldenConstraints): Promise<ConstraintCheck>;
  };
};

export async function runGoldenEntry(
  apiUrl: string,
  entry: GoldenEntry,
  tags: TagLookup,
  options: RunGoldenEntryOptions = {},
): Promise<GoldenResult> {
  const k = options.k ?? 8;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const { recommendations, model, pipelineVersion, replay } = await fetchRecommendations(
    apiUrl,
    entry.query,
    entry.obscurityTarget,
    { fetchImpl: options.fetchImpl, apiToken: options.apiToken },
  );
  const latencyMs = now() - startedAt;
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

  const resolved = await Promise.all(topK.map((r) => tags.tagsFor(r)));
  const tagSets = resolved.map((t) => t?.tags ?? []);
  const tagSources = {
    musicbrainz: resolved.filter((t) => t?.source === "musicbrainz").length,
    lastfm: resolved.filter((t) => t?.source === "lastfm").length,
    none: resolved.filter((t) => !t?.source).length,
  };

  const unidentified = topK.filter((r) => !r.musicbrainzArtistId).length;
  if (unidentified > 0) {
    warnings.push(`${unidentified} of ${topK.length} top-8 results have no musicbrainzArtistId`);
  }
  const lookupFailures = resolved.filter((t) => t === null).length;
  if (lookupFailures > 0) {
    warnings.push(`${lookupFailures} tag lookup(s) failed — coverage may understate quality`);
  }

  const antiBandRateAt8 = computeAntiBandRate(antiBands, resultNames, k);
  const nuggetCoverageAt8 = computeNuggetCoverage(nuggets, tagSets, k);
  const uncoveredNuggets = findUncoveredNuggets(nuggets, tagSets, k);

  // If no top-8 band yielded any tags at all, coverage is measuring MusicBrainz
  // availability rather than recommendation quality. Report it, don't gate on it.
  const tagsUsable = tagSets.some((t) => t.length > 0);
  const coverageGateApplies = nuggets.length > 0 && tagsUsable;
  if (nuggets.length > 0 && !tagsUsable) {
    warnings.push("no tags available for any top-8 result — coverage gate skipped");
  }
  if (coverageGateApplies && nuggetCoverageAt8 < minCoverage) {
    warnings.push(`uncovered nuggets: ${uncoveredNuggets.join(", ")}`);
  }

  let constraintRateAt8: number | null = null;
  let constraintVerdicts: GoldenResult["constraintVerdicts"] = null;
  if (entry.constraints) {
    if (options.constraintChecker) {
      const checks = await Promise.all(topK.map((r) => options.constraintChecker!.check(r, entry.constraints!)));
      const verdicts = checks.map((c) => c.verdict);
      constraintRateAt8 = constraintRate(verdicts);
      constraintVerdicts = {
        met: verdicts.filter((v) => v === "met").length,
        missed: verdicts.filter((v) => v === "missed").length,
        unknown: verdicts.filter((v) => v === "unknown").length,
      };
      if (constraintRateAt8 === null) warnings.push("no top-8 band could be checked against the constraints — gate skipped");
    } else {
      warnings.push("query has constraints but the runner has no constraint checker");
    }
  }

  let judgeScores: JudgeMeans | null = null;
  if (options.judge && topK.length > 0) {
    const { judge } = options;
    if (model && modelFamily(judge.modelId) === modelFamily(model)) {
      warnings.push(
        `judge ${judge.modelId} and research model ${model} are from the same model family (${modelFamily(model)})`,
      );
    }
    try {
      const inputs: JudgeInput[] = await Promise.all(
        topK.map(async (r) => {
          const listeners = judge.listenersOf ? await judge.listenersOf(r.artist) : null;
          const evidence = checkEvidence(r.why ?? "", r.sourceSignals ?? []);
          return {
            bandName: r.artist,
            query: entry.query,
            obscurityTarget: entry.obscurityTarget ?? null,
            why: r.why ?? "",
            sourceSignals: r.sourceSignals ?? [],
            listeners,
            obscurityTier: listeners === null ? null : classifyObscurityTier(listeners),
            citationSupportRate: evidence.citationSupportRate,
            genericWhyFlag: evidence.genericWhyFlag,
          };
        }),
      );
      const { scores } = await judgeWithVotes(judge.model, inputs, { votes: judge.votes ?? 1 });
      const meanOf = (key: keyof NumericScores) => {
        const values = topK.map((r) => scores[r.artist]?.[key]).filter((v): v is number => typeof v === "number");
        return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
      };
      judgeScores = {
        relevance: meanOf("relevance"),
        obscurityFit: meanOf("obscurity_fit"),
        evidenceQuality: meanOf("evidence_quality"),
        discoveryValue: meanOf("discovery_value"),
      };
    } catch (error) {
      warnings.push(`judge failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const failedGates: GoldenGate[] = [];
  // Without a band every other check is skipped, which must not read as a pass.
  if (recommendations.length === 0) failedGates.push("noResults");
  if (antiBandRateAt8 > 0.5) failedGates.push("antiBand");
  if (coverageGateApplies && nuggetCoverageAt8 < minCoverage) failedGates.push("coverage");
  if (constraintRateAt8 !== null && constraintRateAt8 < (entry.minConstraintRate ?? DEFAULT_MIN_CONSTRAINT_RATE)) {
    failedGates.push("constraint");
  }
  const passed = failedGates.length === 0;

  return {
    id: entry.id,
    query: entry.query,
    status: passed ? "pass" : "fail",
    resultNames,
    antiBandRateAt8,
    nuggetCoverageAt8: coverageGateApplies ? nuggetCoverageAt8 : null,
    uncoveredNuggets,
    passed,
    warnings,
    latencyMs,
    model,
    pipelineVersion,
    replay,
    tagSources,
    constraintRateAt8,
    constraintVerdicts,
    failedGates,
    judgeScores,
  };
}

/** The result for a query the runner could not get an answer to. */
export function goldenErrorResult(entry: GoldenEntry, err: unknown): GoldenResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    id: entry.id,
    query: entry.query,
    status: "error",
    resultNames: [],
    antiBandRateAt8: 0,
    nuggetCoverageAt8: null,
    uncoveredNuggets: entry.nuggets ?? [],
    passed: false,
    warnings: [`runner error: ${message}`],
    latencyMs: null,
    model: null,
    pipelineVersion: null,
    replay: null,
    tagSources: { musicbrainz: 0, lastfm: 0, none: 0 },
    constraintRateAt8: null,
    constraintVerdicts: null,
    failedGates: [],
    judgeScores: null,
    error: message,
  };
}

function formatPct(value: number | null): string {
  return value === null ? "unknown" : `${(value * 100).toFixed(0)}%`;
}

function printTable(results: GoldenResult[]): void {
  console.log("\n=== Golden Dataset Results ===\n");
  for (const r of results) {
    const status = r.status === "error" ? "! ERROR" : r.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`${status}  ${r.id}`);
    console.log(`  Query:       ${r.query}`);
    console.log(`  Results:     ${r.resultNames.slice(0, 5).join(", ")}${r.resultNames.length > 5 ? "…" : ""}`);
    console.log(`  AntiBand@8:  ${(r.antiBandRateAt8 * 100).toFixed(0)}%`);
    console.log(`  Nugget@8:    ${formatPct(r.nuggetCoverageAt8)}`);
    for (const w of r.warnings) {
      console.log(`  ⚠  ${w}`);
    }
    console.log();
  }
}

/** Where committed run history lives; reports and the dashboard stay local. */
export const GOLDEN_HISTORY_PATH = join(__dirname, "history", "golden-runs.jsonl");

async function main(): Promise<void> {
  loadEnv({ path: join(__dirname, "../../.env"), quiet: true });
  const { values: args } = parseArgs({
    options: {
      label: { type: "string" },
      notes: { type: "string" },
      repeat: { type: "string" },
      judge: { type: "string" },
      "judge-votes": { type: "string" },
      strict: { type: "boolean", default: false },
      "no-history": { type: "boolean", default: false },
      "allow-dirty": { type: "boolean", default: false },
    },
  });
  const apiUrl = process.env.BANDSEARCH_API_URL ?? "http://localhost:3001";
  const apiToken = process.env.BANDSEARCH_API_TOKEN?.trim() || undefined;
  const recordHistory = !args["no-history"];

  // A run on uncommitted code cannot be traced back to what ran, so it only
  // enters the history when the operator says so explicitly.
  const git = readGitState([GOLDEN_HISTORY_PATH]);
  if (recordHistory && git?.dirty && !args["allow-dirty"]) {
    console.error(
      "Tracked files have uncommitted changes, so this run's commit would not say what ran.\n" +
        "Commit first, or pass --allow-dirty (recorded as dirty) or --no-history.",
    );
    process.exit(2);
  }

  const goldenSet: GoldenEntry[] = JSON.parse(
    readFileSync(join(__dirname, "golden-set.json"), "utf8"),
  );

  console.log(`Running ${goldenSet.length} golden queries against ${apiUrl}`);

  // BANDSEARCH_MB_BASE_URL points the tag lookups at a stub, so the runner can
  // be exercised end-to-end without depending on MusicBrainz being up.
  // Live traffic: spacing lives in createMusicBrainzClient (process-wide 1.1s).
  // Stub: disable client throttle; tag resolver also unthrottled.
  const mbBaseUrl = process.env.BANDSEARCH_MB_BASE_URL;
  // EVAL_REPLAY_DIR: the same recordings the API replays (#250); the replaying
  // transport spaces real MusicBrainz calls, so the client's own gate is off.
  const replayDir = process.env.EVAL_REPLAY_DIR?.trim();
  const lookupFetch = replayDir
    ? createReplayFetch({ dir: replayDir, minIntervalMsByHost: { "musicbrainz.org": 1100 } })
    : undefined;
  const lastFmKey = process.env.LASTFM_API_KEY?.trim();
  const mbClient = memoizeArtistLookups(
    createMusicBrainzClient({
      ...(mbBaseUrl ? { baseUrl: mbBaseUrl, minIntervalMs: 0 } : {}),
      ...(lookupFetch ? { fetchImpl: lookupFetch, minIntervalMs: 0 } : {}),
    }),
  );
  const constraintChecker = createConstraintChecker(mbClient);
  const tags = createTagLookup({
    musicBrainz: createTagResolver(mbClient, 0),
    lastFm: lastFmKey ? createLastFmClient({ apiKey: lastFmKey, fetchImpl: lookupFetch }) : undefined,
  });
  if (!lastFmKey) console.warn("LASTFM_API_KEY not set: coverage uses MusicBrainz tags only.");

  // --judge model[:reasoning] scores each query's top bands with that Scaleway
  // judge (calibrated with npm run calibrate); --judge-votes N takes the median.
  let judge: RunGoldenEntryOptions["judge"];
  let judgeConfig: GoldenJudgeConfig | null = null;
  if (args.judge) {
    const [judgeModelId, effort] = args.judge.split(":");
    judgeConfig = {
      model: judgeModelId!,
      reasoningEffort: effort || "none",
      votes: Math.max(1, Number.parseInt(args["judge-votes"] ?? "1", 10) || 1),
    };
    const lastFm = lastFmKey ? createLastFmClient({ apiKey: lastFmKey, fetchImpl: lookupFetch }) : null;
    judge = {
      // The same settings as the live judge (judgeModelFor): temperature 0, JSON mode.
      model: createChatModelFactory(
        { provider: "scaleway", model: judgeConfig.model, reasoningEffort: judgeConfig.reasoningEffort },
        {
          geminiApiKey: "",
          scalewayApiKey: process.env.SCW_SECRET_KEY ?? "",
          scalewayBaseUrl: process.env.SCW_BASE_URL?.trim() ?? "",
        },
      )({ temperature: 0, json: true }),
      modelId: judgeConfig.model,
      votes: judgeConfig.votes,
      listenersOf: lastFm ? (artist) => lastFm.getListenerCount(artist) : undefined,
    };
    console.log(`Judging top bands with ${judgeConfig.model} (reasoning ${judgeConfig.reasoningEffort}, ${judgeConfig.votes} vote(s))`);
  }
  // --repeat N: N runs of the same setup, each recorded on its own. The
  // dashboard groups them, so per-query means average out single-run noise.
  const repeat = Math.max(1, Number.parseInt(args.repeat ?? "1", 10) || 1);
  const results: GoldenResult[] = [];
  for (let round = 1; round <= repeat; round += 1) {
    if (repeat > 1) console.log(`\n=== Run ${round} of ${repeat} ===`);
    const startedAt = new Date();
    const runResults = await runGoldenEntriesSequentially(
      goldenSet,
      async (entry) => {
        console.log(`→ ${entry.id}`);
        const result = await runGoldenEntry(apiUrl, entry, tags, { apiToken, constraintChecker, judge });
        const status = result.passed ? "PASS" : "FAIL";
        console.log(
          `  ${status}  anti=${formatPct(result.antiBandRateAt8)}  nugget=${formatPct(result.nuggetCoverageAt8)}` +
            `  ${((result.latencyMs ?? 0) / 1000).toFixed(1)}s` +
            (result.warnings.length ? `  ⚠ ${result.warnings.join("; ")}` : ""),
        );
        return result;
      },
      {
        // Keep going so one flaky 502 does not wipe the whole suite.
        pauseMs: 3000,
        onError(entry, err) {
          const result = goldenErrorResult(entry, err);
          console.error(`  ERROR  ${entry.id}: ${result.error}`);
          return result;
        },
      },
    );
    results.push(...runResults);
    printTable(runResults);

    if (recordHistory) {
      const record = buildGoldenRunRecord({
        entries: goldenSet,
        results: runResults,
        startedAt,
        finishedAt: new Date(),
        label: args.label ?? null,
        notes: args.notes ?? null,
        git,
        apiUrl,
        judge: judgeConfig,
      });
      appendRun(GOLDEN_HISTORY_PATH, record);
      console.log(`Recorded run ${record.runId} (model: ${record.config.researchModel ?? "not reported"}) in ${GOLDEN_HISTORY_PATH}`);
    }
  }
  if (recordHistory) {
    console.log(`Dashboard: ${pathToFileURL(writeDashboard({ historyPath: GOLDEN_HISTORY_PATH })).href}`);
  }

  const warnCount = results.reduce((n, r) => n + r.warnings.length, 0);
  if (warnCount > 0) {
    console.log(`${warnCount} warning(s) — see above`);
  }

  if (args.strict) {
    const strictFailed = results.filter((r) => r.antiBandRateAt8 > 0);
    if (strictFailed.length > 0) {
      console.error(`\n[--strict] ${strictFailed.length} query(ies) have anti-bands in top-8`);
      process.exit(1);
    }
  }

  const errors = results.filter((r) => r.status === "error");
  const gateText: Record<GoldenGate, string> = {
    noResults: "returned no band at all",
    antiBand: "failed the anti-band gate (rate > 50%)",
    coverage: "fell below their minNuggetCoverage",
    constraint: "missed their hard constraints",
  };
  const failedByGate = (gate: GoldenGate) => results.filter((r) => r.failedGates.includes(gate)).length;

  if (errors.length > 0) {
    console.error(`\n${errors.length} query(ies) got no answer from the API`);
  }
  for (const gate of Object.keys(gateText) as GoldenGate[]) {
    const n = failedByGate(gate);
    if (n > 0) console.error(`${n} query(ies) ${gateText[gate]}`);
  }
  if (errors.length > 0 || results.some((r) => r.failedGates.length > 0)) {
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
