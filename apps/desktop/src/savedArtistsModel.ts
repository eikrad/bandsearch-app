import type { ArtistGroup, ArtistSearchResult, SavedBand } from "./domain.js";

/** The slice of the bootstrapped app this model drives. */
export type SavedArtistsCollaborator = {
  listSavedBands(): Promise<SavedBand[]>;
  deleteSavedBand(id: string): Promise<unknown>;
  searchArtists(query: string): Promise<ArtistSearchResult[]>;
};

export function createSavedArtistsModel({ app }: { app: SavedArtistsCollaborator }) {
  const state: {
    savedArtists: SavedBand[];
    selectedIds: Set<string>;
    searchResults: ArtistSearchResult[];
    isSearching: boolean;
    isLoading: boolean;
    // Never written here: grouping lives in createSavedArtistsShell, and the
    // saved-artists screen is served from that shell in the running app. Kept
    // so the screen-state shape stays whole — see ROADMAP "Saved-Artists:
    // Modell und Shell zusammenführen".
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
  };
}

/** The screen state the saved-artists view renders, derived so the two cannot drift. */
export type SavedArtistsScreenState = ReturnType<
  ReturnType<typeof createSavedArtistsModel>["getScreenState"]
>;
export type SavedArtistItem = SavedArtistsScreenState["artists"][number];
