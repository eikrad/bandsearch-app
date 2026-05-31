import type { EvalRepository, PipelineDiagnostics } from "./evalRepository.js";
import type { LastFmClient } from "./lastFmClient.js";
import { classifyObscurityTier } from "./obscurityScorer.js";

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

function extractBandNames(recommendations: unknown[]): string[] {
  if (!Array.isArray(recommendations)) {
    return [];
  }
  const names: string[] = [];
  for (const item of recommendations) {
    if (item && typeof item === "object" && typeof (item as { artist?: unknown }).artist === "string") {
      const name = (item as { artist: string }).artist.trim();
      if (name) {
        names.push(name);
      }
    }
  }
  return names;
}

export function createEvalWorker({
  evalRepository,
  lastFmClient,
}: {
  evalRepository: EvalRepository;
  lastFmClient?: LastFmClient;
}): EvalWorker {
  async function scoreObscurity(eventId: string, bandNames: string[]) {
    if (!lastFmClient) {
      return;
    }
    await Promise.allSettled(
      bandNames.map(async (bandName) => {
        const listeners = await lastFmClient.getListenerCount(bandName);
        await evalRepository.upsertBandEvalScore({
          eventId,
          bandName,
          listeners,
          obscurityTier: classifyObscurityTier(listeners),
        });
      }),
    );
  }

  return {
    async processEvent(ctx) {
      const eventId = await evalRepository.logEvent({
        query: ctx.query,
        mode: ctx.mode,
        sessionId: ctx.sessionId ?? null,
        obscurityTarget: ctx.obscurityTarget ?? null,
        pipelineVersion: ctx.pipelineVersion,
        pipelineDiagnostics: ctx.pipelineDiagnostics,
        recommendationCount: Array.isArray(ctx.recommendations) ? ctx.recommendations.length : 0,
      });

      const bandNames = extractBandNames(ctx.recommendations);
      await scoreObscurity(eventId, bandNames);
      // Phase 8.4: enrichWithHeuristics
      // Phase 8.5: judgeEvent
    },
  };
}
