// Turning saved bands into prompt text.
//
// This used to be two methods (`buildContext` / `buildContextForIds`) on every
// preference adapter — four copies of one rule, differing only in how they
// filtered. The rule is not a storage concern: it decides what the LLM sees, so
// it belongs next to the recommendation pipeline that consumes it. Adapters are
// left with plain CRUD, and there is one place to change the prompt format.

export type SavedBandForContext = {
  id: string;
  name: string;
  rating: number | null;
  categories: string[];
  note: string;
};

/** The only thing context building needs from a repository. */
export type SavedBandContextSource = {
  listSavedBands: (userId?: string) => Promise<SavedBandForContext[]>;
};

export function formatSavedBandContextLine(band: SavedBandForContext): string {
  return `${band.name} (rating ${band.rating}/5) tags: ${band.categories.join(", ")} note: ${band.note}`;
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
