import type { ArtistGroup, ArtistSearchResult, SavedBand } from "./domain.js";

/** The slice of the bootstrapped app this model drives. */
export type SavedArtistsCollaborator = {
  listSavedBands(): Promise<SavedBand[]>;
  deleteSavedBand(id: string): Promise<unknown>;
  searchArtists(query: string): Promise<ArtistSearchResult[]>;
  // NOTE: bootstrapDesktopApp exposes importPreferences/autoGroup, not these.
  // Optional here so the mismatch is visible rather than a runtime TypeError.
  importArtists?(bands: unknown[]): Promise<{ imported: number; skipped: number; failed?: number }>;
  listGroups(): Promise<ArtistGroup[]>;
  createGroup(name: string): Promise<unknown>;
  autoGroupByGenre?(): Promise<unknown>;
};

export function createSavedArtistsModel({ app }: { app: SavedArtistsCollaborator }) {
  const state: {
    savedArtists: SavedBand[];
    selectedIds: Set<string>;
    searchResults: ArtistSearchResult[];
    isSearching: boolean;
    isLoading: boolean;
    groups: ArtistGroup[];
  } = {
    savedArtists: [],
    selectedIds: new Set(),
    searchResults: [],
    isSearching: false,
    isLoading: false,
    groups: [],
  };

  return {
    async loadSavedArtists() {
      state.isLoading = true;
      try {
        state.savedArtists = await app.listSavedBands();
      } finally {
        state.isLoading = false;
      }
    },

    getScreenState() {
      return {
        header: { title: "Saved Artists", subtitle: "Your style references" },
        isLoading: state.isLoading,
        artists: state.savedArtists.map((band) => ({
          id: band.id,
          name: band.name,
          rating: band.rating,
          categoryTags: band.categories || [],
          note: band.note || "",
          isSelected: state.selectedIds.has(band.id),
        })),
        selectedCount: state.selectedIds.size,
        searchResults: state.searchResults,
        isSearching: state.isSearching,
        groups: state.groups,
      };
    },

    async deleteSavedArtist(id: string) {
      await app.deleteSavedBand(id);
      state.savedArtists = state.savedArtists.filter((b) => b.id !== id);
      state.selectedIds.delete(id);
    },

    toggleSelection(id: string) {
      if (state.selectedIds.has(id)) {
        state.selectedIds.delete(id);
      } else {
        state.selectedIds.add(id);
      }
    },

    clearSelection() {
      state.selectedIds.clear();
    },

    getSelectedIds() {
      return [...state.selectedIds];
    },

    async searchArtists(query: string) {
      if (!query || !query.trim()) {
        state.searchResults = [];
        return;
      }
      state.isSearching = true;
      try {
        state.searchResults = await app.searchArtists(query);
      } finally {
        state.isSearching = false;
      }
    },

    async exportArtists() {
      return [...state.savedArtists];
    },

    async importArtists(bands: unknown[]) {
      if (!app.importArtists) throw new Error("app does not implement importArtists");
      const result = await app.importArtists(bands);
      state.savedArtists = await app.listSavedBands();
      return result;
    },

    async loadGroups() {
      state.groups = await app.listGroups();
    },

    async createGroup(name: string) {
      const result = await app.createGroup(name);
      state.groups = await app.listGroups();
      return result;
    },

    async autoGroupByGenre() {
      if (!app.autoGroupByGenre) throw new Error("app does not implement autoGroupByGenre");
      await app.autoGroupByGenre();
      state.groups = await app.listGroups();
    },
  };
}

/** The screen state the saved-artists view renders, derived so the two cannot drift. */
export type SavedArtistsScreenState = ReturnType<
  ReturnType<typeof createSavedArtistsModel>["getScreenState"]
>;
export type SavedArtistItem = SavedArtistsScreenState["artists"][number];
