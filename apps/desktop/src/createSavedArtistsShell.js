function createSavedArtistsShell({ app }) {
  let state = {
    savedArtists: [],
    selectedIds: [],
    searchQuery: "",
    searchResults: [],
    isSearching: false,
  };

  return {
    getViewProps() {
      return { ...state };
    },
    async loadSavedArtists() {
      const bands = await app.listSavedBands();
      const appSelectedIds = app.getState().selectedArtistIds;
      state = { ...state, savedArtists: bands, selectedIds: appSelectedIds };
    },
    toggleArtistSelection(id) {
      app.toggleArtistSelection(id);
      const appSelectedIds = app.getState().selectedArtistIds;
      state = { ...state, selectedIds: appSelectedIds };
    },
    setSearchQuery(query) {
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
    async addArtist(mbArtist) {
      await app.saveBand(mbArtist.name, { note: mbArtist.disambiguation || "Added via search." });
      const bands = await app.listSavedBands();
      state = { ...state, savedArtists: bands, searchResults: [] };
    },
  };
}

module.exports = { createSavedArtistsShell };
