// Callback surface the React views are handed, plus the prop shapes they render.
//
// Required entries are always wired by createDesktopReactShell; the optional
// ones are called with `?.` in the views because not every host provides them
// (the browser shell wires fewer than the Tauri one).

import type { ArtistGroup, ArtistSearchResult } from "../domain.js";

export type ChatHandlers = {
  onModeChange(mode: string): unknown;
  onQuerySubmit(query: string): unknown;
  onSave(artistName: string): unknown;
  // null clears an existing rating without unsaving the band — see
  // cardActionLogic.ts's nextRatingForStarTap.
  onRate(artistName: string, rating: number | null): unknown;
  onObscurityTargetChange?(target: string | undefined): unknown;
  onCopyCard?(title: string, why: string): unknown;
  onCopyAll?(text: string): unknown;
  onFeedback?(feedbackType: string): unknown;
  onFeedbackDismiss?(): unknown;
  onNavigateSaved?(): unknown;
  onNavigateSettings?(): unknown;
  onStop?(): unknown;
  onRetry?(): unknown;
  onOpenLink?(url: string): unknown;
  /** Save toggled off — removes the band entirely (not the same as clearing a rating). */
  onUnsave?(savedBandId: string, artistName: string): unknown;
  /** The ··· sheet's persistence call. savedBandId is null when the artist isn't saved yet — editing implies saving. */
  onSaveCategoryNote?(artistName: string, savedBandId: string | null, updates: { categories: string[]; note: string }): unknown;
};

/** One saved artist as the saved-artists screen renders it. */
export type SavedArtistItemProps = {
  id: string;
  name: string;
  rating?: number | null;
  categoryTags: string[];
  note: string;
  isSelected: boolean;
};

/**
 * Everything SavedArtistsView renders.
 *
 * Declared here rather than derived from whichever module happens to supply it.
 * When this type was `ReturnType<typeof someModel.getScreenState>` the screen was
 * coupled to one of two competing suppliers, and the other one — the one the
 * `#/saved` route actually used — could return a different shape without anything
 * failing to compile. It did, and the screen threw on `header.title`.
 */
export type SavedArtistsViewProps = {
  header: { title: string; subtitle: string };
  isLoading: boolean;
  artists: SavedArtistItemProps[];
  selectedCount: number;
  searchResults: ArtistSearchResult[];
  isSearching: boolean;
  groups: ArtistGroup[];
};

export type SavedArtistsHandlers = {
  onNavigate?(view: string): unknown;
  onSearch?(query: string): unknown;
  onAddArtist?(artist: { id: string; name: string; disambiguation?: string }): unknown;
  onDelete?(id: string): unknown;
  onToggleSelection?(id: string): unknown;
  onActivateStyleRef?(): unknown;
  onCreateGroup?(name: string): unknown;
  onDeleteGroup?(id: string): unknown;
  onAutoGroup?(): unknown;
  onExport?(): unknown;
  onImportFile?(file: File): unknown;
};

export type WelcomeHandlers = {
  onGoToSettings?(): unknown;
  onSkip?(): unknown;
};

export type UpdateBannerHandlers = {
  onInstall?(): unknown;
  onDismiss?(): unknown;
};

export type ConnectingHandlers = {
  onRetry?(): unknown;
};

/**
 * `waiting` while the API is being polled, `failed` once the retry budget is
 * spent. `attempt` lets the view acknowledge a long wait instead of showing a
 * spinner that looks identical at second 1 and second 60.
 */
export type ConnectingViewProps = {
  state: "waiting" | "failed";
  attempt?: number;
};
