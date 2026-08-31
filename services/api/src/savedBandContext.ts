// Turning saved bands into prompt text.
//
// This used to be two methods (`buildContext` / `buildContextForIds`) on every
// preference adapter — four copies of one rule, differing only in how they
// filtered. The rule is not a storage concern: it decides what the LLM sees, so
// it belongs next to the recommendation pipeline that consumes it. Adapters are
// left with plain CRUD, and there is one place to change the prompt format.

import { formatRatingForPrompt } from "../../../shared/schemas/src/contracts.js";

export type SavedBandForContext = {
  id: string;
  name: string;
  rating: number | null;
  categories: string[];
  note: string;
  // Only a note the user has written or edited counts as their own input; a
  // note still at its model-written pre-fill must not read back to the model
  // as the user's own confirmation of a preference the model introduced
  // (ADR 0002 / #166).
  noteEdited: boolean;
};

/** The only thing context building needs from a repository. */
export type SavedBandContextSource = {
  listSavedBands: (userId?: string) => Promise<SavedBandForContext[]>;
};

export function formatSavedBandContextLine(band: SavedBandForContext): string {
  // An unrated band is still a signal — the user chose to keep it — so it stays
  // in the context, stating only that no judgement was given.
  const base = `${band.name} (${formatRatingForPrompt(band.rating)}) tags: ${band.categories.join(", ")}`;
  // An unedited note is still the model's own words, not the user's — leaving
  // it out of the prompt is what stops that text turning into a confirmation
  // of a preference the model introduced itself (ADR 0002 / #166).
  return band.noteEdited ? `${base} note: ${band.note}` : base;
}

export type SavedBandContextOptions = {
  /** Restrict the context to these saved-band ids. Omit for all of the user's bands. */
  ids?: string[];
  userId?: string;
};

export async function buildSavedBandContext(
  source: SavedBandContextSource,
  { ids, userId }: SavedBandContextOptions = {},
): Promise<string> {
  // An empty selection is a filter that matches nothing, not an absent filter —
  // so it short-circuits instead of falling through to "every band".
  if (ids && ids.length === 0) return "";

  const savedBands = await source.listSavedBands(userId);
  const selected = ids ? savedBands.filter((band) => ids.includes(band.id)) : savedBands;
  if (selected.length === 0) return "";

  return selected.map(formatSavedBandContextLine).join("\n");
}
