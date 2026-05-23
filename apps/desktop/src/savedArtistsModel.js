function createSavedArtistsModel({ app }) {
  const state = {
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

    async deleteSavedArtist(id) {
      await app.deleteSavedBand(id);
      state.savedArtists = state.savedArtists.filter((b) => b.id !== id);
      state.selectedIds.delete(id);
    },

    toggleSelection(id) {
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

    async searchArtists(query) {
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

    async importArtists(bands) {
      const result = await app.importArtists(bands);
      state.savedArtists = await app.listSavedBands();
      return result;
    },

    async loadGroups() {
      state.groups = await app.listGroups();
    },

    async createGroup(name) {
      const result = await app.createGroup(name);
      state.groups = await app.listGroups();
      return result;
    },

    async autoGroupByGenre() {
      await app.autoGroupByGenre();
      state.groups = await app.listGroups();
    },
  };
}

module.exports = { createSavedArtistsModel };
