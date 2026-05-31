import { randomUUID } from "node:crypto";

export type PipelineDiagnostics = {
  braveHitCount: number;
  extractedCandidateCount: number;
  verifiedCount: number;
  reflectionTriggered: boolean;
  searchBudgetUsed: number;
};

export type RecommendationEventInput = {
  query: string;
  mode: string;
  sessionId?: string | null;
  obscurityTarget?: string | null;
  pipelineVersion: string;
  pipelineDiagnostics: PipelineDiagnostics;
  recommendationCount: number;
};

export type RecommendationEvent = RecommendationEventInput & {
  id: string;
  createdAt: string;
};

// A per-(event, band) score row. Deterministic fields (listeners, obscurityTier,
// sourceQuality, citationSupportRate, genericWhyFlag) are populated by the
// automatic eval layers; LLM judge fields are upserted later. All fields beyond
// the identifying pair are optional so each layer can fill in its own slice.
export type BandEvalScoreInput = {
  eventId: string;
  bandName: string;
  listeners?: number | null;
  obscurityTier?: string;
  sourceQuality?: string;
  citationSupportRate?: number;
  genericWhyFlag?: boolean;
};

export type BandEvalScore = BandEvalScoreInput & {
  createdAt: string;
};

export type EvalRepository = {
  logEvent(input: RecommendationEventInput): Promise<string>;
  listEvents(limit?: number): Promise<RecommendationEvent[]>;
  upsertBandEvalScore(input: BandEvalScoreInput): Promise<void>;
  listBandEvalScores(eventId: string): Promise<BandEvalScore[]>;
};

export function createNoOpEvalRepository(): EvalRepository {
  return {
    async logEvent() {
      return "noop";
    },
    async listEvents() {
      return [];
    },
    async upsertBandEvalScore() {},
    async listBandEvalScores() {
      return [];
    },
  };
}

export function createInMemoryEvalRepository(): EvalRepository {
  const events: RecommendationEvent[] = [];
  const bandScores: BandEvalScore[] = [];
  return {
    async logEvent(input) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      events.push({ ...input, id, createdAt });
      return id;
    },
    async listEvents(limit = 50) {
      return [...events]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
    async upsertBandEvalScore(input) {
      const existing = bandScores.find(
        (s) => s.eventId === input.eventId && s.bandName === input.bandName,
      );
      if (existing) {
        Object.assign(existing, input);
        return;
      }
      bandScores.push({ ...input, createdAt: new Date().toISOString() });
    },
    async listBandEvalScores(eventId) {
      return bandScores.filter((s) => s.eventId === eventId);
    },
  };
}
