import type { RecommendationMode } from "../../../shared/schemas/src/contracts.js";
import {
  validateRecommendationHttpBody,
  validateRecommendationMode,
} from "../../../shared/schemas/src/contracts.js";
import { buildSavedBandContext } from "./savedBandContext.js";
import type { SavedBandContextSource } from "./savedBandContext.js";

export type MusicBrainzArtistHit = { id?: string; name: string; score?: number; disambiguation?: string };

export interface RecommendationError extends Error {
  code: string;
  cause?: unknown;
}

export type PreferenceRepositoryFacade = SavedBandContextSource;


/**
 * Match MusicBrainz search hits to recommendation card titles (case-insensitive).
 */
export function enrichRecommendationsWithMbIds(
  items: unknown[],
  artists: MusicBrainzArtistHit[],
): unknown[] {
  if (!Array.isArray(items) || !Array.isArray(artists)) return items;
  return items.map((item) => {
    if (!item || typeof item !== "object") return item;
    const row = item as Record<string, unknown>;
    const artistName = String(row.artist ?? "").trim().toLowerCase();
    const match = artists.find((a) => String(a.name ?? "").trim().toLowerCase() === artistName);
    if (match?.id) {
      return { ...row, musicbrainzArtistId: match.id };
    }
    return item;
  });
}

/**
 * Normalize mode, merge priority text with repository preference context when preference-aware,
 * and collect messages.
 */
export async function resolveRecommendationFacadeInput(
  request: Record<string, unknown> | undefined,
  preferenceRepository: PreferenceRepositoryFacade,
): Promise<{ mode: RecommendationMode; preferenceContext: string; messages: unknown[] }> {
  const req = request ?? {};
  const mode = validateRecommendationMode(req.mode);
  const userId = typeof req.userId === "string" ? req.userId : undefined;
  const selectedArtistIds = Array.isArray(req.selectedArtistIds)
    ? req.selectedArtistIds.filter((id): id is string => typeof id === "string")
    : [];
  const priorityContext = typeof req.priorityContext === "string" ? req.priorityContext.trim() : "";

  let preferenceContext = priorityContext;
  if (mode === "preference-aware") {
    const repoContext = await buildSavedBandContext(preferenceRepository, {
      ids: selectedArtistIds.length > 0 ? selectedArtistIds : undefined,
      userId,
    });
    preferenceContext = [preferenceContext, repoContext].filter(Boolean).join("\n");
  }

  const messages = Array.isArray(req.messages) ? req.messages : [];

  return { mode, preferenceContext, messages };
}

export function validateRecommendationRequest(body: unknown) {
  return validateRecommendationHttpBody(body);
}

export function createRecommendationError(code: string, message: string, cause?: unknown): RecommendationError {
  const error = new Error(message) as RecommendationError;
  error.code = code;
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

