import { t } from "./i18n/i18n.js";
import type { SavedBandTarget } from "./savedBandActions.js";
import type { ArtistGroup, ArtistSearchResult, SavedBand } from "./domain.js";
import type { SavedArtistsViewProps } from "./ui/viewTypes.js";
import { createStatusMessage, type StatusMessage, type StatusMessageOptions } from "./statusMessage.js";

export type ImportOutcome = { imported: number; skipped: number; failed: number };

/** The slice of the bootstrapped app this shell drives. */
export type SavedArtistsShellCollaborator = {
  listSavedBands(): Promise<SavedBand[]>;
  listGroups(): Promise<ArtistGroup[]>;
  getState(): { selectedArtistIds: string[] };
  toggleArtistSelection(id: string): void;
  clearArtistSelection(): void;
  setPendingStyleRef(ids: string[]): void;
  searchArtists(query: string): Promise<ArtistSearchResult[]>;
  saveBand(target: SavedBandTarget): Promise<unknown>;
  deleteSavedBand(id: string): Promise<unknown>;
  exportPreferences(): Promise<unknown[]>;
  importPreferences(bands: unknown[]): Promise<ImportOutcome>;
  createGroup(name: string): Promise<unknown>;
  deleteGroup(id: string): Promise<unknown>;
  autoGroup(): Promise<unknown>;
};

/** What an import did, in one line. Artists the API refused make it an error. */
export function describeImport({ imported, skipped, failed }: ImportOutcome): StatusMessage {
  if (failed > 0) {
    return { type: "error", message: t("savedArtists.status.importedFailed", { count: imported, failed }) };
  }
  return skipped > 0
    ? { type: "success", message: t("savedArtists.status.importedSkipped", { count: imported, skipped }) }
    : { type: "success", message: t("savedArtists.status.imported", { count: imported }) };
}

/** Built when shown, so it is in the language of that moment. */
const notAnExport = (): StatusMessage => ({ type: "error", message: t("savedArtists.status.notAnExport") });

export function createSavedArtistsShell({
  app,
  status: statusOptions,
}: {
  app: SavedArtistsShellCollaborator;
  status?: StatusMessageOptions;
}) {
  // Every action reports its outcome here rather than throwing into a click
  // handler, where a failure used to vanish without a word (#313).
  const status = createStatusMessage(statusOptions);
  let state: {
    savedArtists: SavedBand[];
    groups: ArtistGroup[];
    selectedIds: string[];
    searchQuery: string;
    searchResults: ArtistSearchResult[];
    isSearching: boolean;
    isLoading: boolean;
  } = {
    savedArtists: [],
    groups: [],
    selectedIds: [],
    searchQuery: "",
    searchResults: [],
    isSearching: false,
    isLoading: false,
  };

  async function reloadAll() {
    state = { ...state, isLoading: true };
    try {
      const [bands, groups] = await Promise.all([app.listSavedBands(), app.listGroups()]);
      const appSelectedIds = app.getState().selectedArtistIds;
      state = { ...state, savedArtists: bands, groups, selectedIds: appSelectedIds };
    } catch {
      status.show({ type: "error", message: t("savedArtists.status.loadFailed") });
    } finally {
      state = { ...state, isLoading: false };
    }
  }

  return {
    // Projects internal state into the shape the screen renders. The two are
    // deliberately not the same object: `searchQuery` is shell bookkeeping the
    // view has no use for, and the view wants artists pre-marked as selected.
    getViewProps(): SavedArtistsViewProps {
      return {
        header: { title: t("savedArtists.title"), subtitle: t("savedArtists.subtitle") },
        isLoading: state.isLoading,
        artists: state.savedArtists.map((band) => ({
          id: band.id,
          name: band.name,
          rating: band.rating,
          categoryTags: band.categories || [],
          note: band.note || "",
          isSelected: state.selectedIds.includes(band.id),
        })),
        selectedCount: state.selectedIds.length,
        searchResults: state.searchResults,
        isSearching: state.isSearching,
        groups: state.groups,
        statusMessage: status.get(),
      };
    },
    /** Calls `listener` when the status line clears itself. Returns an unsubscribe. */
    subscribe(listener: () => void) {
      return status.subscribe(listener);
    },
    async loadSavedArtists() {
      await reloadAll();
    },
    toggleArtistSelection(id: string) {
      app.toggleArtistSelection(id);
      const appSelectedIds = app.getState().selectedArtistIds;
      state = { ...state, selectedIds: appSelectedIds };
    },
    // Selection lives on the app, not here: `requestRecommendations` reads
    // `state.selectedArtistIds` as the fallback for priority context, so a
    // second copy in the shell would be a second answer to "what is selected".
    async activateStyleRef() {
      const ids = app.getState().selectedArtistIds;
      app.setPendingStyleRef(ids);
      app.clearArtistSelection();
      state = { ...state, selectedIds: [] };
    },
    setSearchQuery(query: string) {
      state = { ...state, searchQuery: query };
    },
    async searchArtists() {
      const query = state.searchQuery.trim();
      if (!query) return;
      state = { ...state, isSearching: true, searchResults: [] };
      try {
        const results = await app.searchArtists(query);
        state = { ...state, searchResults: results, isSearching: false };
      } catch {
        state = { ...state, isSearching: false };
        status.show({ type: "error", message: t("savedArtists.status.searchFailed") });
      }
    },
    async addArtist(mbArtist: ArtistSearchResult) {
      try {
        await app.saveBand({
          name: mbArtist.name,
          musicbrainzArtistId: mbArtist.id,
          suggestedNote: mbArtist.disambiguation || t("savedArtists.addedViaSearch"),
        });
      } catch {
        status.show({ type: "error", message: t("savedArtists.status.addFailed", { name: mbArtist.name }) });
        return;
      }
      status.show({ type: "success", message: t("savedArtists.status.added", { name: mbArtist.name }) });
      await reloadAll();
    },
    async deleteSavedArtist(id: string) {
      const name = state.savedArtists.find((band) => band.id === id)?.name ?? "the artist";
      try {
        await app.deleteSavedBand(id);
      } catch {
        status.show({ type: "error", message: t("savedArtists.status.removeFailed", { name }) });
        return;
      }
      status.show({ type: "success", message: t("savedArtists.status.removed", { name }) });
      await reloadAll();
    },
    /** The saved artists to download, or undefined when there is nothing to save. */
    async exportArtists(): Promise<unknown[] | undefined> {
      try {
        return await app.exportPreferences();
      } catch {
        status.show({ type: "error", message: t("savedArtists.status.exportFailed") });
        return undefined;
      }
    },
    /** Imports the text of a file the user picked; anything but an export is refused here. */
    async importFile(text: string) {
      let bands: unknown;
      try {
        bands = JSON.parse(text);
      } catch {
        status.show(notAnExport());
        return;
      }
      if (!Array.isArray(bands)) {
        status.show(notAnExport());
        return;
      }
      try {
        status.show(describeImport(await app.importPreferences(bands)));
      } catch {
        status.show({ type: "error", message: t("savedArtists.status.importFailed") });
        return;
      }
      await reloadAll();
    },
    async createGroup(name: string) {
      try {
        await app.createGroup(name);
      } catch {
        status.show({ type: "error", message: t("savedArtists.status.createGroupFailed", { name }) });
        return;
      }
      await reloadAll();
    },
    async deleteGroup(id: string) {
      try {
        await app.deleteGroup(id);
      } catch {
        status.show({ type: "error", message: t("savedArtists.status.deleteGroupFailed") });
        return;
      }
      await reloadAll();
    },
    async autoGroup() {
      try {
        await app.autoGroup();
      } catch {
        status.show({ type: "error", message: t("savedArtists.status.autoGroupFailed") });
        return;
      }
      await reloadAll();
    },
  };
}
