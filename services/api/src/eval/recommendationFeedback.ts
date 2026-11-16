import { validateFeedbackType } from "../../../../shared/schemas/src/contracts.js";
import type { EvalRepository } from "./evalRepository.js";
import type { UserDataStore } from "../privacy/userDataStore.js";

type FeedbackRepository = Pick<EvalRepository, "logFeedback" | "listUserFeedback" | "eraseUserFeedback">;

/** Keep feedback ownership and account export/erasure together, even when eval
 * events and account data live in different databases. The userId argument is
 * supplied by authentication, never taken from the submitted body. */
export function createRecommendationFeedback({ repository, userDataStore }: {
  repository: FeedbackRepository;
  userDataStore: UserDataStore | null;
}) {
  const accountData: UserDataStore | null = userDataStore ? {
    async exportUserData(userId) {
      const bundle = await userDataStore.exportUserData(userId);
      if (!bundle.user) return bundle;
      const feedback = await repository.listUserFeedback(userId);
      // On SQLite both readers can see the same rows. Preserve older rows in
      // the account backend too, without exporting a shared row twice.
      bundle.recommendationFeedback = [...new Map(
        [...bundle.recommendationFeedback, ...feedback].map((row) => [row.id, row]),
      ).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return bundle;
    },
    async eraseUserData(userId) {
      // Remove the separate feedback first. A local failure leaves the account in
      // place for retry; no cross-database transaction is claimed here.
      const feedbackErased = await repository.eraseUserFeedback(userId);
      const erased = await userDataStore.eraseUserData(userId);
      return { ...erased, recommendation_feedback: (erased.recommendation_feedback ?? 0) + feedbackErased };
    },
  } : null;

  return {
    userDataStore: accountData,
    async submit(body: unknown, userId?: string) {
      const eventId = body && typeof body === "object" && "eventId" in body ? body.eventId : undefined;
      if (!eventId || typeof eventId !== "string") {
        return { ok: false as const, error: "eventId is required" };
      }
      const feedbackType = validateFeedbackType(
        body && typeof body === "object" && "feedbackType" in body ? body.feedbackType : undefined,
      );
      if (!feedbackType) {
        return { ok: false as const, error: "feedbackType must be one of: good, too_mainstream, wrong_direction" };
      }
      await repository.logFeedback({ eventId, feedbackType, userId });
      return { ok: true as const };
    },
  };
}

export type RecommendationFeedback = ReturnType<typeof createRecommendationFeedback>;
