import type { EvalRepository, PipelineDiagnostics } from "./evalRepository.js";
import type { LastFmClient } from "./lastFmClient.js";
import { classifyObscurityTier } from "./obscurityScorer.js";
import { scoreSearchSources, ratioToSourceQuality } from "./searchSourceScorer.js";
import { checkEvidence } from "./evidenceChecker.js";

export type EvalEventContext = {
  query: string;
  mode: string;
  sessionId?: string | null;
  userId?: string;
  obscurityTarget?: string | null;
  pipelineVersion: string;
  pipelineDiagnostics: PipelineDiagnostics;
  recommendations: unknown[];
};

export type EvalWorker = {
  processEvent(ctx: EvalEventContext): Promise<void>;
};

export function createNoOpEvalWorker(): EvalWorker {
  return {
    async processEvent() {},
  };
}

type RecommendationItem = {
  artist: string;
  why?: string;
  sourceSignals?: string[];
};

function extractRecommendations(recommendations: unknown[]): RecommendationItem[] {
  if (!Array.isArray(recommendations)) return [];
  const items: RecommendationItem[] = [];
  for (const item of recommendations) {
    if (item && typeof item === "object") {
      const r = item as Record<string, unknown>;
      if (typeof r.artist === "string" && r.artist.trim()) {
        items.push({
          artist: r.artist.trim(),
          why: typeof r.why === "string" ? r.why : undefined,
          sourceSignals: Array.isArray(r.sourceSignals) ? (r.sourceSignals as string[]) : undefined,
        });
      }
    }
  }
  return items;
}

export function createEvalWorker({
  evalRepository,
  lastFmClient,
}: {
  evalRepository: EvalRepository;
  lastFmClient?: LastFmClient;
}): EvalWorker {
  async function scoreObscurity(eventId: string, recs: RecommendationItem[]) {
    if (!lastFmClient) return;
    await Promise.allSettled(
      recs.map(async ({ artist }) => {
        const listeners = await lastFmClient.getListenerCount(artist);
        await evalRepository.upsertBandEvalScore({
          eventId,
          bandName: artist,
          listeners,
          obscurityTier: classifyObscurityTier(listeners),
        });
      }),
    );
  }

  async function scoreHeuristics(eventId: string, recs: RecommendationItem[]) {
    await Promise.allSettled(
      recs.map(async ({ artist, why = "", sourceSignals = [] }) => {
        const urlSignals = sourceSignals.filter((s) => s.startsWith("http"));
        const ratio = scoreSearchSources(urlSignals);
        const sourceQuality = ratioToSourceQuality(ratio);
        const { citationSupportRate, genericWhyFlag } = checkEvidence(why, sourceSignals);
        await evalRepository.upsertBandEvalScore({
          eventId,
          bandName: artist,
          sourceQuality,
          citationSupportRate,
          genericWhyFlag,
        });
      }),
    );
  }

  return {
    async processEvent(ctx) {
      const recs = extractRecommendations(ctx.recommendations);

      const eventId = await evalRepository.logEvent({
        query: ctx.query,
        mode: ctx.mode,
        sessionId: ctx.sessionId ?? null,
        obscurityTarget: ctx.obscurityTarget ?? null,
        pipelineVersion: ctx.pipelineVersion,
        pipelineDiagnostics: ctx.pipelineDiagnostics,
        recommendationCount: recs.length,
      });

      await scoreObscurity(eventId, recs);
      await scoreHeuristics(eventId, recs);
      // Phase 8.5: judgeEvent
    },
  };
}
