import { BandsearchHttpError } from "./chatClient.js";

/**
 * Turns HTTP/API errors from the recommendation endpoint into short, user-facing copy for the chat banner.
 */
export function formatRecommendationQueryError(error: unknown): string {
  if (error instanceof BandsearchHttpError) {
    switch (error.code) {
      case "rate_limit_exceeded":
        return "Too many recommendation requests in a short window. Wait about a minute, then try again.";
      case "recommendation_initializing":
        return "Recommendations are still starting up. Wait a few seconds and try again.";
      case "recommendation_context_unavailable":
        return "Music lookup (MusicBrainz) is temporarily unavailable. Check your network connection and try again.";
      case "search_unavailable":
        return "Web search (Brave) is temporarily unavailable. Check your network connection and try again in a moment.";
      case "recommendation_unavailable":
        return "Gemini could not return recommendations. Open Settings and confirm your API key; if it is correct, Gemini may be busy or unreachable — try again in a moment.";
      case "validation_error":
        return typeof error.message === "string" && error.message.trim()
          ? error.message
          : "That request could not be processed. Try rephrasing your message.";
      case "http_error":
        if (error.status === 429) {
          return "Too many requests. Wait a moment and try again.";
        }
        if (error.status === 503) {
          return "Recommendations are still starting up. Wait a few seconds and try again.";
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
    return "Could not reach the Bandsearch API. If the app just started, wait until the API is ready, then try again.";
  }
  return "Could not reach the Bandsearch API. Check that the API server is running.";
}
