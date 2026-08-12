// Callback surface the React views are handed.
//
// Required entries are always wired by createDesktopReactShell; the optional
// ones are called with `?.` in the views because not every host provides them
// (the browser shell wires fewer than the Tauri one).

export type ChatHandlers = {
  onModeChange(mode: string): unknown;
  onQuerySubmit(query: string): unknown;
  onSave(artistName: string): unknown;
  onRate(artistName: string, rating?: number): unknown;
  onMore(artistName: string): unknown;
  onObscurityTargetChange?(target: string | undefined): unknown;
  onCopyCard?(title: string, why: string): unknown;
  onCopyAll?(text: string): unknown;
  onFeedback?(feedbackType: string): unknown;
  onFeedbackDismiss?(): unknown;
  onNavigateSaved?(): unknown;
  onNavigateSettings?(): unknown;
  onStop?(): unknown;
  onRetry?(): unknown;
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
