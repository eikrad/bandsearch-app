// Pure decision logic behind the recommendation card's action row
// (UI_GUIDELINES.md, "Action row policy"). Kept out of the JSX so it can be
// tested directly instead of through a click simulation renderToStaticMarkup
// cannot do anyway.

import type { CategoryNoteUpdates } from "./savedBandActions.js";

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

/**
 * The Category/Note sheet's draft. Holds ADR 0002 on the client: the API marks
 * a note as the user's own words whenever an update contains `note` at all,
 * and only such notes reach the recommendation prompt. So a field goes into
 * the update only once the user has touched it — never because it has a value.
 */
export type CategoryNoteDraft = {
  readonly categoriesText: string;
  readonly note: string;
  /** The model's own explanation, not yet edited: shown, but kept out of the prompt. */
  readonly noteIsAiSuggested: boolean;
  readonly categoriesTouched: boolean;
  readonly noteTouched: boolean;
};

export function startCategoryNoteDraft(card: { categories: string[]; note: string; noteEdited: boolean }): CategoryNoteDraft {
  return {
    categoriesText: card.categories.join(", "),
    note: card.note,
    noteIsAiSuggested: !card.noteEdited && card.note.length > 0,
    categoriesTouched: false,
    noteTouched: false,
  };
}

export function editCategories(draft: CategoryNoteDraft, categoriesText: string): CategoryNoteDraft {
  return { ...draft, categoriesText, categoriesTouched: true };
}

/** Any edit counts, even one that clears the note or restores its old text. */
export function editNote(draft: CategoryNoteDraft, note: string): CategoryNoteDraft {
  return { ...draft, note, noteTouched: true };
}

export function categoryNoteUpdates(draft: CategoryNoteDraft): CategoryNoteUpdates {
  return {
    ...(draft.categoriesTouched ? { categories: parseCategoriesInput(draft.categoriesText) } : {}),
    ...(draft.noteTouched ? { note: draft.note } : {}),
  };
}
