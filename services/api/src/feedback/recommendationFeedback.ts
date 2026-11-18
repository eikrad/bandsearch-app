import { randomUUID } from "node:crypto";
import {
  FEEDBACK_RETENTION_DAYS,
  validateFeedbackType,
  type FeedbackType,
} from "../../../../shared/schemas/src/contracts.js";

/**
 * Recommendation feedback: a user's verdict on one recommendation batch.
 *
 * Product data, not eval telemetry (ADR 0006). It lives in the main database,
 * next to the account it belongs to, so account export and erasure cover it
 * without reaching into a second store. Each row carries the context it was
 * given about — query, mode, obscurity target, the bands shown — because in
 * production nothing else records the batch, and a verdict without its batch
 * cannot be read.
 *
 * The operator reads it with `npm run feedback:list`; there is no admin
 * endpoint.
 */

export { FEEDBACK_RETENTION_DAYS };

/** Longer queries are cut, not refused: the recommendation route accepts up to 2000. */
export const FEEDBACK_QUERY_MAX_LENGTH = 500;
export const FEEDBACK_BAND_NAMES_MAX = 20;
const BAND_NAME_MAX_LENGTH = 200;
const EVENT_ID_MAX_LENGTH = 100;
const OBSCURITY_TARGET_MAX_LENGTH = 40;
const MODES: ReadonlySet<string> = new Set(["fresh", "preference-aware"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export type RecommendationFeedbackRow = {
  id: string;
  eventId: string;
  /** Null on a personal install without accounts. */
  userId: string | null;
  feedbackType: FeedbackType;
  query: string;
  mode: string;
  obscurityTarget: string | null;
  bandNames: string[];
  createdAt: string;
};

/**
 * One row per event and user: `upsert` replaces an earlier verdict by the same
 * user (or by no user) on the same event.
 */
export type RecommendationFeedbackRepository = {
  upsert(row: RecommendationFeedbackRow): Promise<void>;
  /** Rows created at or after `sinceIso`, oldest first. */
  listSince(sinceIso: string): Promise<RecommendationFeedbackRow[]>;
  /** Deletes rows created before `cutoffIso`. Returns how many went. */
  purgeOlderThan(cutoffIso: string): Promise<number>;
};

export type FeedbackSubmitResult = { ok: true } | { ok: false; error: string };

type Submission = Omit<RecommendationFeedbackRow, "id" | "eventId" | "userId" | "createdAt">;

function parseSubmission(body: unknown): { ok: true; value: Submission } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "a feedback body is required" };
  const input = body as Record<string, unknown>;

  const feedbackType = validateFeedbackType(input.feedbackType);
  if (!feedbackType) {
    return { ok: false, error: "feedbackType must be one of: good, too_mainstream, wrong_direction" };
  }
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query) return { ok: false, error: "query is required" };
  if (typeof input.mode !== "string" || !MODES.has(input.mode)) {
    return { ok: false, error: "mode must be fresh or preference-aware" };
  }
  const target = input.obscurityTarget;
  if (target !== undefined && target !== null && typeof target !== "string") {
    return { ok: false, error: "obscurityTarget must be a string" };
  }
  if (!Array.isArray(input.bandNames) || !input.bandNames.every((name) => typeof name === "string")) {
    return { ok: false, error: "bandNames must be a list of names" };
  }

  return {
    ok: true,
    value: {
      feedbackType,
      query: query.slice(0, FEEDBACK_QUERY_MAX_LENGTH),
      mode: input.mode,
      obscurityTarget: typeof target === "string" && target.trim()
        ? target.trim().slice(0, OBSCURITY_TARGET_MAX_LENGTH)
        : null,
      bandNames: (input.bandNames as string[])
        .slice(0, FEEDBACK_BAND_NAMES_MAX)
        .map((name) => name.slice(0, BAND_NAME_MAX_LENGTH)),
    },
  };
}

export function createRecommendationFeedback({
  repository,
  now = () => new Date(),
}: {
  repository: RecommendationFeedbackRepository;
  now?: () => Date;
}) {
  const daysAgo = (days: number) => new Date(now().getTime() - days * DAY_MS).toISOString();

  return {
    /**
     * Stores a verdict on `eventId`. `userId` comes from authentication, never
     * from the body; null when the install has no accounts.
     */
    async submit(eventId: unknown, body: unknown, userId: string | null): Promise<FeedbackSubmitResult> {
      if (typeof eventId !== "string" || !eventId || eventId.length > EVENT_ID_MAX_LENGTH) {
        return { ok: false, error: "a valid eventId is required" };
      }
      const parsed = parseSubmission(body);
      if (!parsed.ok) return parsed;
      await repository.upsert({
        id: randomUUID(),
        eventId,
        userId,
        ...parsed.value,
        createdAt: now().toISOString(),
      });
      return { ok: true };
    },

    /** Feedback from the last `days` days, oldest first. */
    listRecent(days: number): Promise<RecommendationFeedbackRow[]> {
      return repository.listSince(daysAgo(days));
    },

    /** Enforces the retention period. Returns how many rows went. */
    purgeExpired(): Promise<number> {
      return repository.purgeOlderThan(daysAgo(FEEDBACK_RETENTION_DAYS));
    },
  };
}

export type RecommendationFeedback = ReturnType<typeof createRecommendationFeedback>;
