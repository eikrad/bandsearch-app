import { createHash } from "node:crypto";
import type { EvalRepository } from "./evalRepository.js";
import { OBSCURITY_THRESHOLDS } from "./obscurityScorer.js";
import { writeStructuredLog } from "../http/structuredLog.js";
import { errorMessage, parseModelJsonResponse, withTimeout, type ChatModelClient } from "../agent/modelUtils.js";
import type { LlmConfig } from "../config/models.js";
import { createChatModelFactory } from "../llm/chatModel.js";

export type JudgeInput = {
  bandName: string;
  query: string;
  obscurityTarget?: string | null;
  why?: string;
  sourceSignals?: string[];
  listeners?: number | null;
  obscurityTier?: string | null;
  citationSupportRate?: number;
  genericWhyFlag?: boolean;
};

export type JudgeScoreObject = {
  relevance?: unknown;
  obscurity_fit?: unknown;
  evidence_quality?: unknown;
  discovery_value?: unknown;
  reasoning?: unknown;
};

// Derive the tier description from OBSCURITY_THRESHOLDS so the judge's notion of
// each tier stays identical to the deterministic classifier (obscurityScorer).
// Changing the thresholds in one place keeps the prompt — and calibration — in sync.
const fmt = (n: number) => n.toLocaleString("en-US");
const OBSCURITY_FIT_GUIDANCE =
  `How well does the band match the requested obscurity target? ` +
  `Tiers by Last.fm listeners — ` +
  `cult = ${fmt(OBSCURITY_THRESHOLDS.cult)}–${fmt(OBSCURITY_THRESHOLDS.mainstream)}, ` +
  `underground = ${fmt(OBSCURITY_THRESHOLDS.underground)}–${fmt(OBSCURITY_THRESHOLDS.cult)}, ` +
  `obscure = under ${fmt(OBSCURITY_THRESHOLDS.underground)}, ` +
  `mainstream = over ${fmt(OBSCURITY_THRESHOLDS.mainstream)}. ` +
  `Each band includes its computed obscurity_tier; reward a tier at or below the target ` +
  `and penalise bands more mainstream than requested. Ignore this if no target given.`;

const JUDGE_SYSTEM_PROMPT = `You are an expert music recommendation quality judge. Your task is to evaluate a list of band recommendations against a user's query and produce a JSON object with one score entry per band.

Scoring dimensions (each 0.0–1.0):
- relevance: Does the band genuinely fit the requested genre/style/mood described in the query?
- obscurity_fit: ${OBSCURITY_FIT_GUIDANCE}
- evidence_quality: Is the why-text specific and grounded in cited sources, or generic boilerplate? Penalise generic_why_flag=true and uncited claims.
- discovery_value: Would a curious music fan be genuinely surprised and pleased? Penalise extremely well-known mainstream bands for discovery-focused queries.

Return ONLY a JSON object with this exact structure — no prose, no markdown fences:
{
  "Band Name": {
    "relevance": 0.0,
    "obscurity_fit": 0.0,
    "evidence_quality": 0.0,
    "discovery_value": 0.0,
    "reasoning": "One sentence explanation."
  }
}

Use the exact band names from the input. If a band is unrecognised, score conservatively at 0.5 across all dimensions.`;

export function buildJudgePrompt(bands: JudgeInput[]): { system: string; user: string } {
  const user = JSON.stringify(
    bands.map((b) => ({
      band_name: b.bandName,
      query: b.query,
      obscurity_target: b.obscurityTarget ?? null,
      why: b.why ?? "",
      source_signals: b.sourceSignals ?? [],
      listeners: b.listeners ?? null,
      obscurity_tier: b.obscurityTier ?? null,
      citation_support_rate: b.citationSupportRate ?? null,
      generic_why_flag: b.genericWhyFlag ?? null,
    })),
    null,
    2,
  );
  return { system: JUDGE_SYSTEM_PROMPT, user };
}

export type JudgeWorker = {
  judgeEvent(eventId: string, bands: JudgeInput[]): Promise<void>;
};

export function createNoOpJudgeWorker(): JudgeWorker {
  return { async judgeEvent() {} };
}

/** The configured judge's model, or null when no judge can run (no Scaleway key). */
export function judgeModelFor(llm: LlmConfig, fetchImpl?: typeof fetch): ChatModelClient | null {
  if (!llm.judge) return null;
  // Temperature 0 and JSON mode: scores are compared over time, so the judge
  // should vary as little as the model allows, and the reply must parse.
  return createChatModelFactory(llm.judge, { ...llm, fetchImpl })({ temperature: 0, json: true });
}

/**
 * Scores every band in one call. Throws on a failed call or an unreadable
 * answer; the worker swallows that, calibration wants to see it.
 */
export async function judgeBands(
  judgeModel: ChatModelClient,
  bands: JudgeInput[],
  timeoutMs = DEFAULT_JUDGE_TIMEOUT_MS,
): Promise<{ scores: Record<string, JudgeScoreObject>; promptHash: string }> {
  const { system, user } = buildJudgePrompt(bands);
  const promptHash = createHash("sha256").update(system + user).digest("hex");
  const response = await withTimeout(
    judgeModel.invoke([
      { role: "system", content: system },
      { role: "user", content: user },
    ]),
    timeoutMs,
    "judge timeout",
  );
  const text = typeof response.content === "string" ? response.content : "";
  const parsed = parseModelJsonResponse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("judge answer is not a JSON object");
  }
  return { scores: parsed as Record<string, JudgeScoreObject>, promptHash };
}

/**
 * Live scoring runs after the response has been sent, so a judge on a
 * reasoning model may take its time; it must still end eventually.
 */
const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;

export function createJudgeWorker({
  judgeModel,
  modelId,
  evalRepository,
  timeoutMs = DEFAULT_JUDGE_TIMEOUT_MS,
}: {
  judgeModel: ChatModelClient;
  /** Recorded on every score row, so scores stay attributable when the judge changes. */
  modelId: string;
  evalRepository: EvalRepository;
  timeoutMs?: number;
}): JudgeWorker {
  return {
    async judgeEvent(eventId, bands) {
      if (bands.length === 0) return;
      let result: Awaited<ReturnType<typeof judgeBands>>;
      try {
        result = await judgeBands(judgeModel, bands, timeoutMs);
      } catch (error) {
        writeStructuredLog("warn", {
          component: "judge_worker",
          message: "Judge request failed",
          eventId,
          modelId,
          error: errorMessage(error),
        });
        return;
      }

      await Promise.allSettled(
        bands.map(async ({ bandName }) => {
          const score = result.scores[bandName];
          if (!score || typeof score !== "object") return;
          await evalRepository.upsertBandEvalScore({
            eventId,
            bandName,
            relevance: typeof score.relevance === "number" ? score.relevance : undefined,
            obscurityFit: typeof score.obscurity_fit === "number" ? score.obscurity_fit : undefined,
            evidenceQuality: typeof score.evidence_quality === "number" ? score.evidence_quality : undefined,
            discoveryValue: typeof score.discovery_value === "number" ? score.discovery_value : undefined,
            judgeReasoning: typeof score.reasoning === "string" ? score.reasoning : undefined,
            judgePromptHash: result.promptHash,
            modelId,
          });
        }),
      );
    },
  };
}
