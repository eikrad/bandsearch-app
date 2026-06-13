export function createSavedArtistsShell({ app }: { app: any }) {
  let state: {
    savedArtists: any[];
    groups: any[];
    selectedIds: any[];
    searchQuery: string;
    searchResults: any[];
    isSearching: boolean;
  } = {
    savedArtists: [],
    groups: [],
    selectedIds: [],
    searchQuery: "",
    searchResults: [],
    isSearching: false,
  };

  async function reloadAll() {
    const [bands, groups] = await Promise.all([app.listSavedBands(), app.listGroups()]);
    const appSelectedIds = app.getState().selectedArtistIds;
    state = { ...state, savedArtists: bands, groups, selectedIds: appSelectedIds };
  }

  return {
    getViewProps() {
      return { ...state };
    },
    async loadSavedArtists() {
      await reloadAll();
    },
    toggleArtistSelection(id: string) {
      app.toggleArtistSelection(id);
      const appSelectedIds = app.getState().selectedArtistIds;
      state = { ...state, selectedIds: appSelectedIds };
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
    async addArtist(mbArtist: any) {
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
