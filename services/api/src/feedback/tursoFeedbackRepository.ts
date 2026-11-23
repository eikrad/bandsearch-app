import type { TursoClient } from "../turso/tursoClient.js";
import type { RecommendationFeedbackRepository } from "./recommendationFeedback.js";
import {
  FEEDBACK_INSERT_SQL,
  FEEDBACK_LIST_SQL,
  FEEDBACK_PURGE_SQL,
  FEEDBACK_REPLACE_SQL,
  feedbackInsertArgs,
  rowToFeedback,
} from "./feedbackRepository.js";

/** Turso has the table from `migrations/006_recommendation_feedback.sql`. */
export function createTursoFeedbackRepository({ client }: { client: TursoClient }): RecommendationFeedbackRepository {
  return {
    async upsert(row) {
      // "write" makes the replacement one transaction: the old verdict never
      // disappears without the new one arriving.
      await client.batch(
        [
          { sql: FEEDBACK_REPLACE_SQL, args: [row.eventId, row.userId] },
          { sql: FEEDBACK_INSERT_SQL, args: feedbackInsertArgs(row) },
        ],
        "write",
      );
    },
    async listSince(sinceIso) {
      const result = await client.execute({ sql: FEEDBACK_LIST_SQL, args: [sinceIso] });
      return result.rows.map(rowToFeedback);
    },
    async purgeOlderThan(cutoffIso) {
      const result = await client.execute({ sql: FEEDBACK_PURGE_SQL, args: [cutoffIso] });
      return result.rowsAffected;
    },
  };
}
