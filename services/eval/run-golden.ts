import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type GoldenEntry = {
  id: string;
  query: string;
  obscurityTarget?: string;
  nuggets?: string[];
  antiBands?: string[];
  notes?: string;
};

export type GoldenResult = {
  id: string;
  query: string;
  resultNames: string[];
  precisionAt8: number;
  antiBandRateAt8: number;
  nuggetCoverageAt8: number;
  passed: boolean;
  warnings: string[];
};

export function computePrecisionAtK(expected: string[], results: string[], k: number): number {
  if (expected.length === 0 || results.length === 0) return 0;
  const topK = results.slice(0, k);
  const normalizedExpected = new Set(expected.map((n) => n.toLowerCase()));
  const hits = topK.filter((r) => normalizedExpected.has(r.toLowerCase())).length;
  return hits / expected.length;
}

export function computeAntiBandRate(antiBands: string[], results: string[], k: number): number {
  if (results.length === 0) return 0;
  const topK = results.slice(0, k);
  if (topK.length === 0) return 0;
  const normalizedAnti = new Set(antiBands.map((n) => n.toLowerCase()));
  const hits = topK.filter((r) => normalizedAnti.has(r.toLowerCase())).length;
  return hits / topK.length;
}

export function computeNuggetCoverage(nuggets: string[], results: string[], k: number): number {
  if (nuggets.length === 0) return 0;
  const topK = results.slice(0, k);
  const normalizedNuggets = new Set(nuggets.map((n) => n.toLowerCase()));
  const found = topK.filter((r) => normalizedNuggets.has(r.toLowerCase())).length;
  return found / nuggets.length;
}

async function fetchRecommendations(
  apiUrl: string,
  query: string,
  obscurityTarget?: string,
): Promise<string[]> {
  const body: Record<string, unknown> = { query };
  if (obscurityTarget) body.obscurityTarget = obscurityTarget;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
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

  const data = (await response.json()) as { recommendations?: Array<{ artist?: string }> };
  return (data.recommendations ?? [])
    .map((r) => r.artist ?? "")
    .filter((n) => n.length > 0);
}

async function runGoldenEntry(
  apiUrl: string,
  entry: GoldenEntry,
  k = 8,
): Promise<GoldenResult> {
  const resultNames = await fetchRecommendations(apiUrl, entry.query, entry.obscurityTarget);
  const nuggets = entry.nuggets ?? [];
  const antiBands = entry.antiBands ?? [];

  const precisionAt8 = computePrecisionAtK(nuggets, resultNames, k);
  const antiBandRateAt8 = computeAntiBandRate(antiBands, resultNames, k);
  const nuggetCoverageAt8 = computeNuggetCoverage(nuggets, resultNames, k);

  const warnings: string[] = [];
  if (precisionAt8 < 0.5 && nuggets.length > 0) {
    warnings.push(`precision@8 ${(precisionAt8 * 100).toFixed(0)}% is below 50%`);
  }

  // catastrophic gate: anti-band rate > 0.5 fails the entry
  const passed = antiBandRateAt8 <= 0.5;

  return { id: entry.id, query: entry.query, resultNames, precisionAt8, antiBandRateAt8, nuggetCoverageAt8, passed, warnings };
}

function printTable(results: GoldenResult[]): void {
  console.log("\n=== Golden Dataset Results ===\n");
  for (const r of results) {
    const status = r.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`${status}  ${r.id}`);
    console.log(`  Query:       ${r.query}`);
    console.log(`  Results:     ${r.resultNames.slice(0, 5).join(", ")}${r.resultNames.length > 5 ? "…" : ""}`);
    console.log(`  P@8:         ${(r.precisionAt8 * 100).toFixed(0)}%`);
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

  const results = await Promise.all(goldenSet.map((entry) => runGoldenEntry(apiUrl, entry)));

  printTable(results);

  const failed = results.filter((r) => !r.passed);
  const warnCount = results.reduce((n, r) => n + r.warnings.length, 0);

  if (warnCount > 0) {
    console.log(`${warnCount} warning(s) — precision dropped but not a hard failure`);
  }

  if (strict) {
    const strictFailed = results.filter((r) => r.antiBandRateAt8 > 0);
    if (strictFailed.length > 0) {
      console.error(`\n[--strict] ${strictFailed.length} query(ies) have anti-bands in top-8`);
      process.exit(1);
    }
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} query(ies) failed the anti-band gate (rate > 50%)`);
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
