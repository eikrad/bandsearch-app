import { createHash } from "node:crypto";
import type { EvalRepository } from "./evalRepository.js";
import { OBSCURITY_TARGET_RANGES, fitObscurityTarget, type ObscurityTargetFit } from "../obscurityTargets.js";
import { REPLY_LANGUAGE_JUDGE_RULE, capEvidenceForReplyLanguage } from "../replyLanguage.js";
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
  evidenceUrls?: string[];
  listeners?: number | null;
  citationSupportRate?: number;
  genericWhyFlag?: boolean;
};

export type JudgeScoreObject = {
  query_language?: unknown;
  why_language?: unknown;
  why_in_query_language?: unknown;
  relevance?: unknown;
  obscurity_fit?: unknown;
  evidence_quality?: unknown;
  discovery_value?: unknown;
  reasoning?: unknown;
};

// Derived from OBSCURITY_TARGET_RANGES, and target_range_fit from the research
// filter's own rule, so the judge scores by what the search decides (#325).
// Changing the rule in one place keeps the prompt — and calibration — in sync.
const fmt = (n: number) => n.toLocaleString("en-US");
const fmtRange = ({ min, max }: { min: number; max: number }) => `${fmt(min)}–${fmt(max)}`;
const OBSCURITY_FIT_GUIDANCE =
  `How well does the band match the requested obscurity target? ` +
  `Target ranges by Last.fm listeners — ` +
  `cult = ${fmtRange(OBSCURITY_TARGET_RANGES.cult)}, ` +
  `underground = ${fmtRange(OBSCURITY_TARGET_RANGES.underground)}, ` +
  `obscure = ${fmtRange(OBSCURITY_TARGET_RANGES.obscure)}. ` +
  `Each band includes target_range_fit: inRange, tooObscure or tooMainstream. A band Last.fm has no count for counts as obscure. ` +
  `Score high inside the range and lower the further outside it the band falls, in either direction: ` +
  `a band far more obscure than the target misses it just as a band far more mainstream does. ` +
  `When target_range_fit is null (no target, or no listener counts at all), judge from the evidence.`;

const JUDGE_SYSTEM_PROMPT = `You are an expert music recommendation quality judge. Your task is to evaluate a list of band recommendations against a user's query and produce a JSON object with one score entry per band.

Scoring dimensions (each 0.0–1.0):
- relevance: Does the band genuinely fit the requested genre/style/mood described in the query?
- obscurity_fit: ${OBSCURITY_FIT_GUIDANCE}
- evidence_quality: Is the why-text specific and grounded in cited sources, or generic boilerplate? Penalise generic_why_flag=true and uncited claims. ${REPLY_LANGUAGE_JUDGE_RULE}
- source_signals are categorical provenance labels. evidence_urls are the URLs search retrieved or used to support the why; use citation_support_rate to assess whether cited URLs are among them.
- discovery_value: Would a curious music fan be genuinely surprised and pleased? Penalise extremely well-known mainstream bands for discovery-focused queries.

Return ONLY a JSON object with this exact structure — no prose, no markdown fences:
{
  "Band Name": {
    "query_language": "en",
    "why_language": "en",
    "why_in_query_language": true,
    "relevance": 0.0,
    "obscurity_fit": 0.0,
    "evidence_quality": 0.0,
    "discovery_value": 0.0,
    "reasoning": "One sentence explanation."
  }
}

Use the exact band names from the input. If a band is unrecognised, score conservatively at 0.5 across all dimensions.`;

/** Each band's fit, by the research filter's rule, fitted together with the bands of the same target. */
function targetRangeFits(bands: JudgeInput[]): Array<ObscurityTargetFit | null> {
  const out: Array<ObscurityTargetFit | null> = bands.map(() => null);
  const byTarget = new Map<string, number[]>();
  bands.forEach((b, i) => byTarget.set(b.obscurityTarget ?? "", [...(byTarget.get(b.obscurityTarget ?? "") ?? []), i]));
  for (const [target, indexes] of byTarget) {
    const fits = fitObscurityTarget(indexes.map((i) => bands[i]!.listeners), target);
    if (fits) indexes.forEach((i, k) => (out[i] = fits[k]!.fit));
  }
  return out;
}

export function buildJudgePrompt(bands: JudgeInput[]): { system: string; user: string } {
  const fits = targetRangeFits(bands);
  const user = JSON.stringify(
    bands.map((b, i) => ({
      band_name: b.bandName,
      query: b.query,
      obscurity_target: b.obscurityTarget ?? null,
      why: b.why ?? "",
      source_signals: b.sourceSignals ?? [],
      evidence_urls: b.evidenceUrls ?? [],
      listeners: b.listeners ?? null,
      target_range_fit: fits[i],
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
  const scores = parsed as Record<string, JudgeScoreObject>;
  for (const score of Object.values(scores)) {
    if (score && typeof score === "object") {
      score.evidence_quality = capEvidenceForReplyLanguage(score.evidence_quality, score.why_in_query_language);
    }
  }
  return { scores, promptHash };
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
