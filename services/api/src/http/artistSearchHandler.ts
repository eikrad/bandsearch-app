import type { Response } from "express";

import { sendError } from "./errors.js";

export type ArtistSearchClient = {
  searchArtists: (q: string) => Promise<unknown[]>;
};

/**
 * Canonical artist search: non-empty trimmed query string → MusicBrainz JSON `{ artists }`.
 * Used by GET /artists/search?query= and legacy GET /search/artists?q=
 */
export async function handleArtistSearch(
  res: Response,
  rawQuery: unknown,
  musicBrainzClient: ArtistSearchClient,
) {
  const query = typeof rawQuery === "string" ? rawQuery.trim() : "";
  if (!query) {
    return sendError(res, 400, "validation_error", "search query is required");
  }
  try {
    const artists = await musicBrainzClient.searchArtists(query);
    return res.status(200).json({ artists });
  } catch {
    return sendError(res, 502, "search_unavailable", "artist search unavailable");
  }
}
