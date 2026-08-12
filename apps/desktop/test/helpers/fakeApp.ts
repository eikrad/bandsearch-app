import type { SavedArtistsCollaborator } from "../../src/savedArtistsModel.js";
import type { ChatAppCollaborator } from "../../src/chatAppModel.js";

type DesktopApp = ChatAppCollaborator &
  SavedArtistsCollaborator & {
    getView?(): string;
    navigate?(view: string): unknown;
    saveBand?(artistName: string): unknown;
    rateBand?(artistName: string, rating?: number): unknown;
    setPendingStyleRef?(ids: string[]): void;
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
