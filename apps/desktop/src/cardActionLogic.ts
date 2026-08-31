// Pure decision logic behind the recommendation card's action row
// (UI_GUIDELINES.md, "Action row policy"). Kept out of the JSX so it can be
// tested directly instead of through a click simulation renderToStaticMarkup
// cannot do anyway.

/**
 * Tapping star n sets the rating to n; tapping the currently active star
 * clears it instead — "every write is reversible from the card."
 */
export function nextRatingForStarTap(currentRating: number | null, tappedStar: number): number | null {
  return currentRating === tappedStar ? null : tappedStar;
}

/** Comma-separated category input, trimmed and with blanks dropped. */
export function parseCategoriesInput(text: string): string[] {
  return text
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}
