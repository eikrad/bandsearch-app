import { createHash } from "node:crypto";
import type { EvalRepository } from "./evalRepository.js";
import { writeStructuredLog } from "../http/structuredLog.js";

export type JudgeInput = {
  bandName: string;
  query: string;
  obscurityTarget?: string | null;
  why?: string;
  sourceSignals?: string[];
  listeners?: number | null;
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

const JUDGE_SYSTEM_PROMPT = `You are an expert music recommendation quality judge. Your task is to evaluate a list of band recommendations against a user's query and produce a JSON object with one score entry per band.

Scoring dimensions (each 0.0–1.0):
- relevance: Does the band genuinely fit the requested genre/style/mood described in the query?
- obscurity_fit: How well does the band match the requested obscurity target? (cult < 500k listeners, underground < 100k, obscure < 10k). Ignore this if no target given.
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

export function createJudgeWorker({
  anthropicApiKey,
  evalRepository,
  fetchImpl = globalThis.fetch,
}: {
  anthropicApiKey: string;
  evalRepository: EvalRepository;
  fetchImpl?: typeof globalThis.fetch;
}): JudgeWorker {
  if (!anthropicApiKey) return createNoOpJudgeWorker();

  return {
    async judgeEvent(eventId, bands) {
      if (bands.length === 0) return;

      const { system: systemText, user: userText } = buildJudgePrompt(bands);
      const promptHash = createHash("sha256").update(systemText + userText).digest("hex");

      const requestBody = {
        model: "claude-opus-4-8",
        max_tokens: 4096,
        system: [
          {
            type: "text",
            text: systemText,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userText }],
      };

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicApiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (!response.ok) {
          writeStructuredLog("warn", {
            component: "judge_worker",
            message: `Anthropic API returned ${response.status}`,
            eventId,
          });
          return;
        }

        const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
        const text = data?.content?.find((c) => c.type === "text")?.text ?? "";

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
