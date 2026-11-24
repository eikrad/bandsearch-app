import type { EvalRepository, PipelineDiagnostics } from "./evalRepository.js";
import type { Recommendation } from "../../../../shared/schemas/src/contracts.js";
import type { JudgeWorker, JudgeInput } from "./judgeWorker.js";
import { classifyObscurityTier } from "./obscurityScorer.js";
import { scoreSearchSources, ratioToSourceQuality } from "./searchSourceScorer.js";
import { checkEvidence } from "./evidenceChecker.js";

export type EvalEventContext = {
  eventId?: string;
  query: string;
  mode: string;
  sessionId?: string | null;
  userId?: string;
  obscurityTarget?: string | null;
  pipelineVersion: string;
  pipelineDiagnostics: PipelineDiagnostics;
  recommendations: Recommendation[];
};

export type EvalWorker = {
  processEvent(ctx: EvalEventContext): Promise<void>;
};

export function createNoOpEvalWorker(): EvalWorker {
  return {
    async processEvent() {},
  };
}

export function createEvalWorker({
  evalRepository,
  judgeWorker,
}: {
  evalRepository: EvalRepository;
  judgeWorker?: JudgeWorker;
}): EvalWorker {
  async function scoreObscurity(eventId: string, recs: Recommendation[]) {
    await Promise.allSettled(
      recs.map(async ({ artist, listenerCount }) => {
        await evalRepository.upsertBandEvalScore({
          eventId,
          bandName: artist,
          listeners: listenerCount,
          obscurityTier: classifyObscurityTier(listenerCount),
        });
      }),
    );
  }

  async function scoreHeuristics(eventId: string, recs: Recommendation[]) {
    await Promise.allSettled(
      recs.map(async ({ artist, why, evidenceUrls }) => {
        const ratio = scoreSearchSources(evidenceUrls);
        const sourceQuality = ratioToSourceQuality(ratio);
        const { citationSupportRate, genericWhyFlag } = checkEvidence(why, evidenceUrls);
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
      const recs = ctx.recommendations;

      const eventId = await evalRepository.logEvent({
        id: ctx.eventId,
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

      if (judgeWorker && recs.length > 0) {
        const bandScores = await evalRepository.listBandEvalScores(eventId);
        const judgeInputs: JudgeInput[] = recs.map((r) => {
          const dbScore = bandScores.find((s) => s.bandName === r.artist);
          return {
            bandName: r.artist,
            query: ctx.query,
            obscurityTarget: ctx.obscurityTarget,
            why: r.why,
            sourceSignals: r.sourceSignals,
            evidenceUrls: r.evidenceUrls,
            listeners: dbScore?.listeners,
            citationSupportRate: dbScore?.citationSupportRate,
            genericWhyFlag: dbScore?.genericWhyFlag,
          };
        });
        await judgeWorker.judgeEvent(eventId, judgeInputs);
      }
    },
  };
}
