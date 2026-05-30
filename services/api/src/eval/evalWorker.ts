import type { EvalRepository, PipelineDiagnostics } from "./evalRepository.js";

export type EvalEventContext = {
  query: string;
  mode: string;
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

export function createEvalWorker({ evalRepository }: { evalRepository: EvalRepository }): EvalWorker {
  return {
    async processEvent(ctx) {
      await evalRepository.logEvent({
        query: ctx.query,
        mode: ctx.mode,
        obscurityTarget: ctx.obscurityTarget ?? null,
        pipelineVersion: ctx.pipelineVersion,
        pipelineDiagnostics: ctx.pipelineDiagnostics,
        recommendationCount: Array.isArray(ctx.recommendations) ? ctx.recommendations.length : 0,
      });
      // Phase 8.2: enrichWithObscurityScores
      // Phase 8.4: enrichWithHeuristics
      // Phase 8.5: judgeEvent
    },
  };
}
