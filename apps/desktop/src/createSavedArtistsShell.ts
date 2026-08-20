import type { ArtistGroup, ArtistSearchResult, SavedBand } from "./domain.js";
import type { SavedArtistsViewProps } from "./ui/viewTypes.js";

/** The slice of the bootstrapped app this shell drives. */
export type SavedArtistsShellCollaborator = {
  listSavedBands(): Promise<SavedBand[]>;
  listGroups(): Promise<ArtistGroup[]>;
  getState(): { selectedArtistIds: string[] };
  toggleArtistSelection(id: string): void;
  clearArtistSelection(): void;
  setPendingStyleRef(ids: string[]): void;
  searchArtists(query: string): Promise<ArtistSearchResult[]>;
  saveBand(name: string, options?: { note?: string }): Promise<unknown>;
  deleteSavedBand(id: string): Promise<unknown>;
  exportPreferences(): Promise<unknown[]>;
  importPreferences(bands: unknown[]): Promise<unknown>;
  createGroup(name: string): Promise<unknown>;
  deleteGroup(id: string): Promise<unknown>;
  autoGroup(): Promise<unknown>;
};

export function createSavedArtistsShell({ app }: { app: SavedArtistsShellCollaborator }) {
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
        header: { title: "Saved Artists", subtitle: "Your style references" },
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
      };
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
      }
    },
    async addArtist(mbArtist: ArtistSearchResult) {
      await app.saveBand(mbArtist.name, { note: mbArtist.disambiguation || "Added via search." });
      await reloadAll();
    },
    async deleteSavedArtist(id: string) {
      await app.deleteSavedBand(id);
      await reloadAll();
    },
    async exportArtists() {
      return app.exportPreferences();
    },
    async importArtists(bands: unknown[]) {
      const result = await app.importPreferences(bands);
      await reloadAll();
      return result;
    },
    async createGroup(name: string) {
      await app.createGroup(name);
      await reloadAll();
    },
    async deleteGroup(id: string) {
      await app.deleteGroup(id);
      await reloadAll();
    },
    async autoGroup() {
      await app.autoGroup();
      await reloadAll();
    },
  };
}
