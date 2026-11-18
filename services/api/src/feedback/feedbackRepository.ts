import type { Database } from "better-sqlite3";
import { validateFeedbackType } from "../../../../shared/schemas/src/contracts.js";
import type { RecommendationFeedbackRepository, RecommendationFeedbackRow } from "./recommendationFeedback.js";

/**
 * The recommendation feedback table, as SQLite adapters create it. Turso gets
 * the same shape from `migrations/006_recommendation_feedback.sql`.
 *
 * No foreign key to `recommendation_events`: that table is eval telemetry and
 * exists only where the dashboard runs. No unique index on (event, user)
 * either, because SQLite treats NULL users as distinct; `upsert` replaces with
 * an explicit delete instead.
 */
export const FEEDBACK_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id               TEXT PRIMARY KEY,
    event_id         TEXT NOT NULL,
    user_id          TEXT,
    feedback_type    TEXT NOT NULL,
    query            TEXT NOT NULL,
    mode             TEXT NOT NULL,
    obscurity_target TEXT,
    band_names       TEXT NOT NULL DEFAULT '[]',
    created_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_event_user ON recommendation_feedback (event_id, user_id);
  CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_created_at ON recommendation_feedback (created_at);
`;

export const FEEDBACK_INSERT_SQL = `INSERT INTO recommendation_feedback
  (id, event_id, user_id, feedback_type, query, mode, obscurity_target, band_names, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** `IS ?` so that a click without an account replaces the previous one too. */
export const FEEDBACK_REPLACE_SQL = "DELETE FROM recommendation_feedback WHERE event_id = ? AND user_id IS ?";

export const FEEDBACK_LIST_SQL =
  "SELECT * FROM recommendation_feedback WHERE created_at >= ? ORDER BY created_at ASC, rowid ASC";

export const FEEDBACK_PURGE_SQL = "DELETE FROM recommendation_feedback WHERE created_at < ?";

export function feedbackInsertArgs(row: RecommendationFeedbackRow) {
  return [
    row.id, row.eventId, row.userId, row.feedbackType, row.query, row.mode,
    row.obscurityTarget, JSON.stringify(row.bandNames), row.createdAt,
  ];
}

function parseBandNames(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function rowToFeedback(row: Record<string, unknown>): RecommendationFeedbackRow {
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    userId: row.user_id === null || row.user_id === undefined ? null : String(row.user_id),
    feedbackType: validateFeedbackType(row.feedback_type) ?? "good",
    query: String(row.query ?? ""),
    mode: String(row.mode ?? ""),
    obscurityTarget: row.obscurity_target === null || row.obscurity_target === undefined ? null : String(row.obscurity_target),
    bandNames: parseBandNames(row.band_names),
    createdAt: String(row.created_at),
  };
}

export function createInMemoryFeedbackRepository(): RecommendationFeedbackRepository {
  let rows: RecommendationFeedbackRow[] = [];
  const copy = (row: RecommendationFeedbackRow) => ({ ...row, bandNames: [...row.bandNames] });
  return {
    async upsert(row) {
      rows = rows.filter((r) => !(r.eventId === row.eventId && r.userId === row.userId));
      rows.push(copy(row));
    },
    async listSince(sinceIso) {
      return rows
        .filter((r) => r.createdAt >= sinceIso)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(copy);
    },
    async purgeOlderThan(cutoffIso) {
      const before = rows.length;
      rows = rows.filter((r) => r.createdAt >= cutoffIso);
      return before - rows.length;
    },
  };
}

export function createSqliteFeedbackRepository({ db }: { db: Database }): RecommendationFeedbackRepository {
  // Before ADR 0006 the eval store created this table without context and with
  // a foreign key to its events. Those rows cannot be read on their own, and
  // nothing ever read them, so the old shape is replaced rather than migrated.
  const columns = db.prepare("PRAGMA table_info(recommendation_feedback)").all() as { name: string }[];
  if (columns.length > 0 && !columns.some((column) => column.name === "query")) {
    db.exec("DROP TABLE recommendation_feedback");
  }
  db.exec(FEEDBACK_TABLE_DDL);

  const replace = db.transaction((row: RecommendationFeedbackRow) => {
    db.prepare(FEEDBACK_REPLACE_SQL).run(row.eventId, row.userId);
    db.prepare(FEEDBACK_INSERT_SQL).run(...feedbackInsertArgs(row));
  });

  return {
    async upsert(row) {
      replace(row);
    },
    async listSince(sinceIso) {
      return (db.prepare(FEEDBACK_LIST_SQL).all(sinceIso) as Record<string, unknown>[]).map(rowToFeedback);
    },
    async purgeOlderThan(cutoffIso) {
      return db.prepare(FEEDBACK_PURGE_SQL).run(cutoffIso).changes;
    },
  };
}
