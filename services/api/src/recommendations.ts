import type { ChatMessage, RecommendationMode } from "../../../shared/schemas/src/contracts.js";
import {
  validateRecommendationHttpBody,
  validateRecommendationMode,
} from "../../../shared/schemas/src/contracts.js";

export type MusicBrainzArtistHit = { id?: string; name: string; score?: number; disambiguation?: string };

export interface RecommendationError extends Error {
  code: string;
  cause?: unknown;
}

export type PreferenceRepositoryFacade = {
  buildContext: () => Promise<string>;
  buildContextForIds: (ids: string[]) => Promise<string>;
};

export type RecommendationAgent = {
  recommend: (input: {
    query: string;
    artists: MusicBrainzArtistHit[];
    mode: RecommendationMode;
    preferenceContext: string;
    messages: ChatMessage[];
  }) => Promise<{ recommendations: unknown[]; assistantReply?: string }>;
};

export type MusicBrainzSearchClient = {
  searchArtists: (query: string) => Promise<MusicBrainzArtistHit[]>;
};

export type MusicBrainzQueryPlannerFn = (input: {
  userQuery: string;
  preferenceContext: string;
  messages: ChatMessage[];
}) => Promise<string>;

export type MusicBrainzQueryResolutionLog = {
  userQuery: string;
  resolvedMbQuery: string;
  plannerEnabled: boolean;
};

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
 * Shared façade step: normalize mode, merge priority text with repository preference context when
 * preference-aware, and collect messages. Used by the lazy-init pipeline and the app fallback stack.
 */
export async function resolveRecommendationFacadeInput(
  request: Record<string, unknown> | undefined,
  preferenceRepository: PreferenceRepositoryFacade,
): Promise<{ mode: RecommendationMode; preferenceContext: string; messages: unknown[] }> {
  const req = request ?? {};
  const mode = validateRecommendationMode(req.mode);
  const selectedArtistIds = Array.isArray(req.selectedArtistIds)
    ? req.selectedArtistIds.filter((id): id is string => typeof id === "string")
    : [];
  const priorityContext = typeof req.priorityContext === "string" ? req.priorityContext.trim() : "";

  let preferenceContext = priorityContext;
  if (mode === "preference-aware") {
    let repoContext: string;
    if (selectedArtistIds.length > 0) {
      repoContext = await preferenceRepository.buildContextForIds(selectedArtistIds);
    } else {
      repoContext = await preferenceRepository.buildContext();
    }
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

export function createRecommendationService({
  musicBrainzClient,
  recommendationAgent,
  planMusicBrainzSearch,
  onMusicBrainzQueryResolved,
}: {
  musicBrainzClient?: MusicBrainzSearchClient;
  recommendationAgent?: RecommendationAgent;
  planMusicBrainzSearch?: MusicBrainzQueryPlannerFn;
  onMusicBrainzQueryResolved?: (info: MusicBrainzQueryResolutionLog) => void;
} = {}) {
  if (!musicBrainzClient || typeof musicBrainzClient.searchArtists !== "function") {
    throw createRecommendationError(
      "recommendation_configuration_error",
      "musicBrainzClient.searchArtists is required",
    );
  }
  if (!recommendationAgent || typeof recommendationAgent.recommend !== "function") {
    throw createRecommendationError(
      "recommendation_configuration_error",
      "recommendationAgent.recommend is required",
    );
  }

  return {
    async getRecommendations(
      query: string,
      options: {
        mode?: unknown;
        preferenceContext?: string;
        messages?: ChatMessage[];
      } = {},
    ) {
      const mode = validateRecommendationMode(options.mode);
      const preferenceContext = mode === "preference-aware" ? options.preferenceContext || "" : "";

      const messages = Array.isArray(options.messages) ? options.messages : [];
      let resolvedMbQuery = String(query || "").trim();
      const plannerEnabled = Boolean(planMusicBrainzSearch);
      if (planMusicBrainzSearch) {
        try {
          const planned = await planMusicBrainzSearch({
            userQuery: query,
            preferenceContext,
            messages,
          });
          const trimmed = typeof planned === "string" ? planned.trim() : "";
          if (trimmed) resolvedMbQuery = trimmed;
        } catch {
          resolvedMbQuery = String(query || "").trim();
        }
      }

      onMusicBrainzQueryResolved?.({
        userQuery: query,
        resolvedMbQuery,
        plannerEnabled,
      });

      let artists: MusicBrainzArtistHit[];
      try {
        artists = await musicBrainzClient.searchArtists(resolvedMbQuery);
      } catch (error) {
        throw createRecommendationError(
          "recommendation_context_unavailable",
          "recommendation context unavailable",
          error,
        );
      }

      try {
        const { recommendations: rawItems, assistantReply } = await recommendationAgent.recommend({
          query,
          artists,
          mode,
          preferenceContext,
          messages,
        });
        const recommendations = enrichRecommendationsWithMbIds(rawItems as unknown[], artists);
        return { recommendations, assistantReply: typeof assistantReply === "string" ? assistantReply : "" };
      } catch (error) {
        throw createRecommendationError("recommendation_unavailable", "recommendation unavailable", error);
      }
    },
  };
}
