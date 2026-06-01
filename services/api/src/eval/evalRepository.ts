import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { AggregatedMetrics } from "./evalAggregator.js";

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
  // LLM judge fields (Phase 8.5) — upserted after automatic scoring
  relevance?: number;
  obscurityFit?: number;
  evidenceQuality?: number;
  discoveryValue?: number;
  judgeReasoning?: string;
  judgePromptHash?: string;
  modelId?: string;
};

export type BandEvalScore = BandEvalScoreInput & {
  createdAt: string;
};

export type EvalBaseline = {
  id: string;
  label: string;
  metricsJson: string;
  createdAt: string;
};

export type EvalRepository = {
  logEvent(input: RecommendationEventInput): Promise<string>;
  listEvents(limit?: number): Promise<RecommendationEvent[]>;
  upsertBandEvalScore(input: BandEvalScoreInput): Promise<void>;
  listBandEvalScores(eventId: string): Promise<BandEvalScore[]>;
  listBandEvalScoresByEventIds(eventIds: string[]): Promise<BandEvalScore[]>;
  createBaseline(label: string, metrics: AggregatedMetrics): Promise<EvalBaseline>;
  listBaselines(): Promise<EvalBaseline[]>;
  getLatestBaseline(): Promise<EvalBaseline | null>;
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
    async listBandEvalScoresByEventIds() {
      return [];
    },
    async createBaseline(label, metrics) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      return { id, label, metricsJson: JSON.stringify(metrics), createdAt };
    },
    async listBaselines() {
      return [];
    },
    async getLatestBaseline() {
      return null;
    },
  };
}

export function createInMemoryEvalRepository(): EvalRepository {
  const events: RecommendationEvent[] = [];
  const bandScores: BandEvalScore[] = [];
  const baselines: EvalBaseline[] = [];
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
    async listBandEvalScoresByEventIds(eventIds) {
      const set = new Set(eventIds);
      return bandScores.filter((s) => set.has(s.eventId));
    },
    async createBaseline(label, metrics) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const baseline: EvalBaseline = { id, label, metricsJson: JSON.stringify(metrics), createdAt };
      baselines.push(baseline);
      return baseline;
    },
    async listBaselines() {
      return [...baselines].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getLatestBaseline() {
      if (baselines.length === 0) return null;
      return [...baselines].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    },
  };
}

type EventRow = {
  id: string;
  session_id: string | null;
  query: string;
  mode: string;
  obscurity_target: string | null;
  pipeline_version: string;
  brave_hit_count: number;
  extracted_count: number;
  verified_count: number;
  reflection_triggered: number;
  search_budget_used: number;
  recommendation_count: number;
  created_at: string;
};

type BandScoreRow = {
  id: string;
  event_id: string;
  band_name: string;
  listeners: number | null;
  obscurity_tier: string | null;
  source_quality: string | null;
  citation_support_rate: number | null;
  generic_why_flag: number | null;
  relevance: number | null;
  obscurity_fit: number | null;
  evidence_quality: number | null;
  discovery_value: number | null;
  judge_reasoning: string | null;
  judge_prompt_hash: string | null;
  model_id: string | null;
  created_at: string;
};

type BaselineRow = {
  id: string;
  label: string;
  metrics_json: string;
  created_at: string;
};

function mapBaselineRow(r: BaselineRow): EvalBaseline {
  return { id: r.id, label: r.label, metricsJson: r.metrics_json, createdAt: r.created_at };
}

function mapEventRow(row: EventRow): RecommendationEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    query: row.query,
    mode: row.mode,
    obscurityTarget: row.obscurity_target,
    pipelineVersion: row.pipeline_version,
    pipelineDiagnostics: {
      braveHitCount: row.brave_hit_count,
      extractedCandidateCount: row.extracted_count,
      verifiedCount: row.verified_count,
      reflectionTriggered: row.reflection_triggered === 1,
      searchBudgetUsed: row.search_budget_used,
    },
    recommendationCount: row.recommendation_count,
    createdAt: row.created_at,
  };
}

function mapScoreRow(row: BandScoreRow): BandEvalScore {
  return {
    eventId: row.event_id,
    bandName: row.band_name,
    listeners: row.listeners ?? undefined,
    obscurityTier: row.obscurity_tier ?? undefined,
    sourceQuality: row.source_quality ?? undefined,
    citationSupportRate: row.citation_support_rate ?? undefined,
    genericWhyFlag: row.generic_why_flag !== null ? row.generic_why_flag === 1 : undefined,
    relevance: row.relevance ?? undefined,
    obscurityFit: row.obscurity_fit ?? undefined,
    evidenceQuality: row.evidence_quality ?? undefined,
    discoveryValue: row.discovery_value ?? undefined,
    judgeReasoning: row.judge_reasoning ?? undefined,
    judgePromptHash: row.judge_prompt_hash ?? undefined,
    modelId: row.model_id ?? undefined,
    createdAt: row.created_at,
  };
}

export function createSqliteEvalRepository({ db }: { db: Database }): EvalRepository {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recommendation_events (
      id                   TEXT PRIMARY KEY,
      session_id           TEXT,
      query                TEXT NOT NULL,
      mode                 TEXT NOT NULL,
      obscurity_target     TEXT,
      pipeline_version     TEXT NOT NULL,
      brave_hit_count      INTEGER NOT NULL DEFAULT 0,
      extracted_count      INTEGER NOT NULL DEFAULT 0,
      verified_count       INTEGER NOT NULL DEFAULT 0,
      reflection_triggered INTEGER NOT NULL DEFAULT 0,
      search_budget_used   INTEGER NOT NULL DEFAULT 0,
      recommendation_count INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS band_eval_scores (
      id                   TEXT PRIMARY KEY,
      event_id             TEXT NOT NULL REFERENCES recommendation_events(id),
      band_name            TEXT NOT NULL,
      listeners            INTEGER,
      obscurity_tier       TEXT,
      source_quality       TEXT,
      citation_support_rate REAL,
      generic_why_flag     INTEGER,
      relevance            REAL,
      obscurity_fit        REAL,
      evidence_quality     REAL,
      discovery_value      REAL,
      judge_reasoning      TEXT,
      judge_prompt_hash    TEXT,
      model_id             TEXT,
      created_at           TEXT NOT NULL,
      UNIQUE(event_id, band_name)
    );
    CREATE INDEX IF NOT EXISTS idx_band_eval_scores_event_id ON band_eval_scores (event_id);
    CREATE TABLE IF NOT EXISTS eval_baselines (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
  `);

  return {
    async logEvent(input) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const d = input.pipelineDiagnostics;
      db.prepare(`
        INSERT INTO recommendation_events
          (id, session_id, query, mode, obscurity_target, pipeline_version,
           brave_hit_count, extracted_count, verified_count, reflection_triggered,
           search_budget_used, recommendation_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.sessionId ?? null, input.query, input.mode,
        input.obscurityTarget ?? null, input.pipelineVersion,
        d.braveHitCount, d.extractedCandidateCount, d.verifiedCount,
        d.reflectionTriggered ? 1 : 0, d.searchBudgetUsed,
        input.recommendationCount, createdAt,
      );
      return id;
    },

    async listEvents(limit = 50) {
      const rows = db.prepare(
        `SELECT * FROM recommendation_events ORDER BY created_at DESC LIMIT ?`,
      ).all(limit) as EventRow[];
      return rows.map(mapEventRow);
    },

    async upsertBandEvalScore(input) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();

      db.prepare(`
        INSERT INTO band_eval_scores
          (id, event_id, band_name, listeners, obscurity_tier, source_quality,
           citation_support_rate, generic_why_flag, relevance, obscurity_fit,
           evidence_quality, discovery_value, judge_reasoning, judge_prompt_hash,
           model_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, band_name) DO UPDATE SET
          listeners            = excluded.listeners,
          obscurity_tier       = excluded.obscurity_tier,
          source_quality       = excluded.source_quality,
          citation_support_rate = excluded.citation_support_rate,
          generic_why_flag     = excluded.generic_why_flag,
          relevance            = excluded.relevance,
          obscurity_fit        = excluded.obscurity_fit,
          evidence_quality     = excluded.evidence_quality,
          discovery_value      = excluded.discovery_value,
          judge_reasoning      = excluded.judge_reasoning,
          judge_prompt_hash    = excluded.judge_prompt_hash,
          model_id             = excluded.model_id
      `).run(
        id, input.eventId, input.bandName,
        input.listeners ?? null,
        input.obscurityTier ?? null,
        input.sourceQuality ?? null,
        input.citationSupportRate ?? null,
        input.genericWhyFlag !== undefined ? (input.genericWhyFlag ? 1 : 0) : null,
        input.relevance ?? null,
        input.obscurityFit ?? null,
        input.evidenceQuality ?? null,
        input.discoveryValue ?? null,
        input.judgeReasoning ?? null,
        input.judgePromptHash ?? null,
        input.modelId ?? null,
        createdAt,
      );
    },

    async listBandEvalScores(eventId) {
      const rows = db.prepare(
        `SELECT * FROM band_eval_scores WHERE event_id = ? ORDER BY created_at ASC`,
      ).all(eventId) as BandScoreRow[];
      return rows.map(mapScoreRow);
    },

    async listBandEvalScoresByEventIds(eventIds) {
      if (eventIds.length === 0) return [];
      const placeholders = eventIds.map(() => "?").join(", ");
      const rows = db.prepare(
        `SELECT * FROM band_eval_scores WHERE event_id IN (${placeholders}) ORDER BY event_id, created_at ASC`,
      ).all(...eventIds) as BandScoreRow[];
      return rows.map(mapScoreRow);
    },

    async createBaseline(label, metrics) {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      const metricsJson = JSON.stringify(metrics);
      db.prepare(
        `INSERT INTO eval_baselines (id, label, metrics_json, created_at) VALUES (?, ?, ?, ?)`,
      ).run(id, label, metricsJson, createdAt);
      return { id, label, metricsJson, createdAt };
    },

    async listBaselines() {
      const rows = db.prepare(
        `SELECT * FROM eval_baselines ORDER BY created_at DESC`,
      ).all() as BaselineRow[];
      return rows.map(mapBaselineRow);
    },

    async getLatestBaseline() {
      const row = db.prepare(
        `SELECT * FROM eval_baselines ORDER BY created_at DESC LIMIT 1`,
      ).get() as BaselineRow | undefined;
      return row ? mapBaselineRow(row) : null;
    },
  };
}
