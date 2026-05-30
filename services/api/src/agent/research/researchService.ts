import type { ChatMessage } from "../../../../../shared/schemas/src/contracts.js";
import { validateRecommendationMode } from "../../../../../shared/schemas/src/contracts.js";

import type { MusicBrainzArtistHit } from "../../recommendations.js";
import { enrichRecommendationsWithMbIds } from "../../recommendations.js";

import { invokeResearchGraph, type ResearchGraphDeps } from "./researchGraph.js";

export type ResearchRecommendationServiceConfig = {
  graphDeps: ResearchGraphDeps;
};

export function createResearchRecommendationService({ graphDeps }: ResearchRecommendationServiceConfig) {
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

      const { recommendations: rawItems, assistantReply, pipelineDiagnostics } = await invokeResearchGraph(graphDeps, {
        userQuery: query,
        preferenceContext,
        messages,
        mode,
      });

      const items = Array.isArray(rawItems) ? rawItems : [];
      const artists: MusicBrainzArtistHit[] = [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const row = item as Record<string, unknown>;
        const id = row.musicbrainzArtistId;
        const name = row.artist;
        if (typeof id === "string" && id.trim() && typeof name === "string" && name.trim()) {
          artists.push({
            id: id.trim(),
            name: name.trim(),
            score: 100,
            disambiguation: "",
          });
        }
      }

      const recommendations = enrichRecommendationsWithMbIds(items, artists);
      return {
        recommendations,
        assistantReply: typeof assistantReply === "string" ? assistantReply : "",
        pipelineDiagnostics,
      };
    },
  };
}
