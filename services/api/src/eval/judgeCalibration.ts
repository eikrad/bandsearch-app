export type HumanLabel = {
  bandName: string;
  humanScores: {
    relevance: number;
    obscurityFit: number;
    evidenceQuality: number;
  };
};

export type CalibrationJudgeScore = {
  bandName: string;
  relevance?: number | null;
  obscurityFit?: number | null;
  evidenceQuality?: number | null;
  discoveryValue?: number | null;
};

export type AgreementResult = {
  rate: number;
  perDimension: {
    relevance: number;
    obscurityFit: number;
    evidenceQuality: number;
  };
};

type Dimension = "relevance" | "obscurityFit" | "evidenceQuality";

const DIMENSIONS: Dimension[] = ["relevance", "obscurityFit", "evidenceQuality"];

function isHigh(score: number): boolean {
  return score >= 0.5;
}

export function computeAgreementRate(
  humanLabels: HumanLabel[],
  judgeScores: CalibrationJudgeScore[],
): AgreementResult {
  const scoreByBand = new Map<string, CalibrationJudgeScore>();
  for (const s of judgeScores) scoreByBand.set(s.bandName, s);

  const counts: Record<Dimension, { agree: number; total: number }> = {
    relevance: { agree: 0, total: 0 },
    obscurityFit: { agree: 0, total: 0 },
    evidenceQuality: { agree: 0, total: 0 },
  };

  for (const label of humanLabels) {
    const judgeScore = scoreByBand.get(label.bandName);
    if (!judgeScore) continue;

    for (const dim of DIMENSIONS) {
      const judgeVal = judgeScore[dim];
      if (judgeVal == null) continue;
      const humanVal = label.humanScores[dim];
      counts[dim].total++;
      if (isHigh(humanVal) === isHigh(judgeVal)) counts[dim].agree++;
    }
  }

  const perDimension = {
    relevance: counts.relevance.total === 0 ? 0 : counts.relevance.agree / counts.relevance.total,
    obscurityFit:
      counts.obscurityFit.total === 0 ? 0 : counts.obscurityFit.agree / counts.obscurityFit.total,
    evidenceQuality:
      counts.evidenceQuality.total === 0
        ? 0
        : counts.evidenceQuality.agree / counts.evidenceQuality.total,
  };

  const totalAgree = counts.relevance.agree + counts.obscurityFit.agree + counts.evidenceQuality.agree;
  const totalComparisons = counts.relevance.total + counts.obscurityFit.total + counts.evidenceQuality.total;

  return {
    rate: totalComparisons === 0 ? 0 : totalAgree / totalComparisons,
    perDimension,
  };
}

export type ExpectedDirection = "low" | "high";

export type UnitTestCase = {
  id: string;
  description: string;
  bandName: string;
  expectedDirection: {
    evidenceQuality?: ExpectedDirection;
    obscurityFit?: ExpectedDirection;
    relevance?: ExpectedDirection;
    discoveryValue?: ExpectedDirection;
  };
};

export type UnitTestFailure = {
  id: string;
  description: string;
  dimension: string;
  expected: ExpectedDirection;
  actual: number | null | undefined;
};

export type UnitTestResult = {
  passRate: number;
  failures: UnitTestFailure[];
};

export function runUnitTests(
  tests: UnitTestCase[],
  judgeScores: CalibrationJudgeScore[],
): UnitTestResult {
  if (tests.length === 0) return { passRate: 1.0, failures: [] };

  const scoreByBand = new Map<string, CalibrationJudgeScore>();
  for (const s of judgeScores) scoreByBand.set(s.bandName, s);

  const failures: UnitTestFailure[] = [];
  let totalChecks = 0;
  let failedChecks = 0;

  for (const tc of tests) {
    const judgeScore = scoreByBand.get(tc.bandName);
    const checkedDimensions = Object.keys(tc.expectedDirection) as Array<keyof typeof tc.expectedDirection>;

    for (const dim of checkedDimensions) {
      const expected = tc.expectedDirection[dim];
      if (!expected) continue;

      totalChecks++;
      const actual = judgeScore ? judgeScore[dim as keyof CalibrationJudgeScore] as number | null | undefined : undefined;

      const actualDirection: ExpectedDirection | null =
        actual == null ? null : isHigh(actual) ? "high" : "low";

      if (actualDirection !== expected) {
        failedChecks++;
        failures.push({
          id: tc.id,
          description: tc.description,
          dimension: dim,
          expected,
          actual: actual ?? undefined,
        });
      }
    }
  }

  return {
    passRate: totalChecks === 0 ? 1.0 : (totalChecks - failedChecks) / totalChecks,
    failures,
  };
}
