import type { ChatAppCollaborator } from "../../src/chatAppModel.js";
import type { ArtistSearchResult, SavedBand } from "../../src/domain.js";

type DesktopApp = ChatAppCollaborator & {
  listSavedBands(): Promise<SavedBand[]>;
  deleteSavedBand(id: string): Promise<unknown>;
  searchArtists(query: string): Promise<ArtistSearchResult[]>;
  saveBand?(artistName: string): unknown;
  rateBand?(artistName: string, rating: number | null): unknown;
  saveCategoryNote?(
    artistName: string,
    savedBandId: string | null,
    updates: { categories: string[]; note: string },
  ): unknown;
};

// A complete app double, so each test only states the collaborator calls it
// actually exercises instead of restating the whole surface.
export function fakeDesktopApp(overrides: Partial<DesktopApp> = {}): DesktopApp {
  return {
    requestRecommendations: async () => ({ meta: {} }),
    sendFeedback: async () => undefined,
    getState: () => ({ messages: [], savedBands: [] }),
    listSavedBands: async () => [],
    deleteSavedBand: async () => undefined,
    searchArtists: async () => [],
    ...overrides,
  };
}
