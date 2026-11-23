import type { SavedBand } from "./preferenceRepository.js";

/**
 * Reads a `saved_bands` row whose values arrive untyped: from libSQL/Turso, or
 * from SQLite when the caller has no typed row. The one home of how stored
 * values become a `SavedBand` (#174).
 */
export function rowToSavedBand(row: Record<string, unknown>): SavedBand {
  return {
    id: String(row.id),
    musicbrainzArtistId: String(row.musicbrainz_artist_id),
    name: String(row.name),
    // Number(null) is 0, outside the 1-5 domain: a rating the user never gave
    // has to stay absent rather than become a bogus zero.
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    categories: parseCategories(row.categories),
    note: String(row.note ?? ""),
    noteEdited: Boolean(Number(row.note_edited ?? 0)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Malformed stored categories read as none, so one bad row cannot break a whole list. */
function parseCategories(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
