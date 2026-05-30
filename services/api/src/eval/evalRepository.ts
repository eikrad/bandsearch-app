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
  obscurityTarget?: string | null;
  pipelineVersion: string;
  pipelineDiagnostics: PipelineDiagnostics;
  recommendationCount: number;
};

export type RecommendationEvent = RecommendationEventInput & {
  id: string;
  createdAt: string;
};

export type EvalRepository = {
  logEvent(input: RecommendationEventInput): Promise<string>;
  listEvents(limit?: number): Promise<RecommendationEvent[]>;
};

export function createNoOpEvalRepository(): EvalRepository {
  return {
    async logEvent() {
      return "noop";
    },
    async listEvents() {
      return [];
    },
  };
}

export function createInMemoryEvalRepository(): EvalRepository {
  const events: RecommendationEvent[] = [];
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
  };
}
