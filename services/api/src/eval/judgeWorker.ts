import { createHash } from "node:crypto";
import type { EvalRepository } from "./evalRepository.js";
import { OBSCURITY_THRESHOLDS } from "./obscurityScorer.js";
import { writeStructuredLog } from "../http/structuredLog.js";

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

type JudgeScoreObject = {
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

/**
 * Mistral's chat-completions endpoint.
 *
 * `MISTRAL_JUDGE_ENDPOINT` allows `https://api.eu.mistral.ai/...`, which Mistral
 * offers for EU data residency — relevant here because the judge is sent the
 * recommendation prose and the user's query context.
 */
const JUDGE_ENDPOINT = process.env.MISTRAL_JUDGE_ENDPOINT?.trim() || "https://api.mistral.ai/v1/chat/completions";
const JUDGE_MODEL = process.env.MISTRAL_JUDGE_MODEL?.trim() || "mistral-large-latest";

export function createJudgeWorker({
  mistralApiKey,
  evalRepository,
  fetchImpl = globalThis.fetch,
}: {
  mistralApiKey: string;
  evalRepository: EvalRepository;
  fetchImpl?: typeof globalThis.fetch;
}): JudgeWorker {
  if (!mistralApiKey) return createNoOpJudgeWorker();

  return {
    async judgeEvent(eventId, bands) {
      if (bands.length === 0) return;

      const { system: systemText, user: userText } = buildJudgePrompt(bands);
      const promptHash = createHash("sha256").update(systemText + userText).digest("hex");

      const requestBody = {
        model: JUDGE_MODEL,
        max_tokens: 4096,
        // Mistral's API is OpenAI-shaped: the system prompt is a message, not a
        // separate field, and there is no prompt-caching block to attach.
        messages: [
          { role: "system", content: systemText },
          { role: "user", content: userText },
        ],
        // The prompt already demands JSON; asking the API for it as well removes
        // a class of parse failure this worker would otherwise swallow.
        response_format: { type: "json_object" },
      };

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetchImpl(JUDGE_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mistralApiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          writeStructuredLog("warn", {
            component: "judge_worker",
            message: `Mistral API returned ${response.status}`,
            eventId,
          });
          return;
        }

        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data?.choices?.[0]?.message?.content ?? "";

        let scores: Record<string, JudgeScoreObject>;
        try {
          const parsed: unknown = JSON.parse(text);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return;
          }
          scores = parsed as Record<string, JudgeScoreObject>;
        } catch {
          writeStructuredLog("warn", {
            component: "judge_worker",
            message: "Failed to parse judge response JSON",
            eventId,
            text: text.slice(0, 200),
          });
          return;
        }

        await Promise.allSettled(
          bands.map(async ({ bandName }) => {
            const score = scores[bandName];
            if (!score || typeof score !== "object") return;
            await evalRepository.upsertBandEvalScore({
              eventId,
              bandName,
              relevance: typeof score.relevance === "number" ? score.relevance : undefined,
              obscurityFit: typeof score.obscurity_fit === "number" ? score.obscurity_fit : undefined,
              evidenceQuality: typeof score.evidence_quality === "number" ? score.evidence_quality : undefined,
              discoveryValue: typeof score.discovery_value === "number" ? score.discovery_value : undefined,
              judgeReasoning: typeof score.reasoning === "string" ? score.reasoning : undefined,
              judgePromptHash: promptHash,
              modelId: "claude-opus-4-8",
            });
          }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          writeStructuredLog("warn", {
            component: "judge_worker",
            message: "Judge request timed out",
            eventId,
          });
          return;
        }
        writeStructuredLog("warn", {
          component: "judge_worker",
          message: "Judge request failed",
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
  };
}
