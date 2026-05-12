# Design: LLM-planned MusicBrainz artist search query

**Date:** 2026-05-12  
**Status:** Implemented

## Goal

Improve MusicBrainz recall for conversational or abstract user prompts by adding a **Gemini planning step** that outputs a short, Lucene-friendly `musicBrainzQuery` before `searchArtists`. The user’s HTTP `query` remains the canonical natural-language turn; the recommender Gemini step still receives the full `query`, MB hits, preferences, and `messages`.

## Success criteria (agreed)

- **Balanced grounding (C):** MB search uses the planned string; final recommendations may still reference artists beyond MB hits with honest `sourceSignals` / copy.
- **Fallback:** If planner output is invalid twice (including JSON parse / sanitize failure), use trimmed original `query` for MusicBrainz.
- **Follow-up turns:** Each `POST /recommendations` runs the planner again with `current_user_query` + **recent** conversation excerpt (tail of `messages`, char cap) + `preference_context`.

## Architecture

1. **`createMusicBrainzQueryPlanner`** (`services/api/src/agent/musicBrainzQueryPlanner.ts`): Gemini `gemini-2.5-flash`, low temperature, returns only `{"musicBrainzQuery":"..."}`. Two attempts: normal system prompt, then one retry with a stricter correction addendum. The system prompt appends a **curated reference** from `services/api/src/agent/prompts/musicbrainz-artist-search.md` (loaded once from disk, cached in memory) so MB field behaviour stays maintainable without pasting the full upstream doc.
2. **`sanitizeMusicBrainzQueryCandidate`:** Non-empty after trim, max 200 chars, no newlines / ASCII control characters.
3. **`createRecommendationService`** (`recommendations.ts`): Optional `planMusicBrainzSearch`; resolves `resolvedMbQuery` then calls `musicBrainzClient.searchArtists(resolvedMbQuery)`. Recommender still called with original `query`. Optional `onMusicBrainzQueryResolved` for structured logs.
4. **`createRecommendationPipeline`:** `Promise.all` to build `runModel` and `planMusicBrainzSearch`; wires logging via `pipelineLog` (`musicbrainz_search_query_resolved`).

## Shared parsing

- **`parseModelJsonResponse`** and **`withTimeout`** exported from `recommendationAgent.ts` for reuse by the planner.

## Testing

- Planner: sanitize, `tryParseMusicBrainzQueryFromModelText`, empty API key rejection.
- Service: when `planMusicBrainzSearch` provided, MB client receives planned string; recommender still receives original user `query`.

## Operational notes

- Extra Gemini call per recommendation: planner timeout `min(4000ms, recommendationTimeoutMs)`.
- Log fields: `userQuery` (truncated), `resolvedMbQuery`, `plannerEnabled`, `differsFromUser`.
