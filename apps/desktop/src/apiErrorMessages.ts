import { t } from "./i18n/i18n.js";
import { BandsearchHttpError } from "./chatClient.js";

/**
 * Turns HTTP/API errors from the recommendation endpoint into short, user-facing copy for the chat banner.
 */
export function formatRecommendationQueryError(error: unknown): string {
  if (error instanceof BandsearchHttpError) {
    switch (error.code) {
      case "rate_limit_exceeded":
        return t("errors.rateLimited");
      case "recommendation_initializing":
        return t("errors.starting");
      case "recommendation_context_unavailable":
        return t("errors.musicBrainzUnavailable");
      case "search_unavailable":
        return t("errors.searchUnavailable");
      case "recommendation_unavailable":
        return t("errors.modelUnavailable");
      // A search runs as a job on the server (ADR 0006); these are its ends
      // that are not an answer.
      case "search_lost":
        return t("errors.searchLost");
      case "search_cancelled":
        return t("errors.searchCancelled");
      case "search_disconnected":
        return t("errors.searchDisconnected");
      case "validation_error":
        return typeof error.message === "string" && error.message.trim()
          ? error.message
          : t("errors.invalidRequest");
      case "http_error":
        if (error.status === 429) {
          return t("errors.tooManyRequests");
        }
        if (error.status === 503) {
          return t("errors.starting");
        }
        break;
      default:
        break;
    }
    if (typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  if (error instanceof TypeError) {
    return t("errors.unreachableStarting");
  }
  return t("errors.unreachable");
}
