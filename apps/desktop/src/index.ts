import type { SavedBandTarget, CategoryNoteUpdates } from "./savedBandActions.js";
import { createChatRenderAdapter } from "./chatRenderAdapter.js";
import { createDesktopReactShell } from "./ui/createDesktopReactShell.js";
import { createDesktopReactMount } from "./ui/mountDesktopReactApp.js";
import type { DesktopReactMountOptions } from "./ui/mountDesktopReactApp.js";
import { createChatAppModel, type ChatAppCollaborator } from "./chatAppModel.js";
import type { ChatHandlers } from "./ui/viewTypes.js";
import { bootstrapDesktopApp } from "./bootstrapDesktopApp.js";

export { bootstrapDesktopApp };

/**
 * Everything index.ts asks of the bootstrapped app. Scoped to the chat screen —
 * the saved-artists screen states its own needs in `SavedArtistsShellCollaborator`
 * and is assembled in `startDesktopBrowserApp`, not here.
 */
type DesktopAppCollaborator = ChatAppCollaborator & {
  saveBand?(target: SavedBandTarget): unknown;
  rateBand?(target: SavedBandTarget, rating: number | null): unknown;
  deleteSavedBand?(savedBandId: string): unknown;
  saveCategoryNote?(
    target: SavedBandTarget,
    updates: CategoryNoteUpdates,
  ): unknown;
};

function bootstrapDesktopRenderAdapter({ app, viewport = "desktop" }: { app: DesktopAppCollaborator; viewport?: string }) {
  return createChatRenderAdapter({ chat: createChatAppModel({ app }), viewport });
}

function bootstrapDesktopReactShell({
  app,
  viewport = "desktop",
  actionHandlers = {},
}: {
  app: DesktopAppCollaborator;
  viewport?: string;
  actionHandlers?: Partial<ChatHandlers>;
}) {
  const renderAdapter = bootstrapDesktopRenderAdapter({ app, viewport });
  const mergedActionHandlers = {
    onSave: actionHandlers.onSave || ((target: SavedBandTarget) => app.saveBand?.(target)),
    // Forwards whatever rating the star row sent — no default here. A
    // hardcoded fallback is exactly how "Rate" used to always write 5 (#153).
    onRate:
      actionHandlers.onRate || ((target: SavedBandTarget, rating: number | null) => app.rateBand?.(target, rating)),
    onUnsave:
      actionHandlers.onUnsave
      || ((savedBandId: string, artistName: string) => {
        void artistName;
        return app.deleteSavedBand?.(savedBandId);
      }),
    onSaveCategoryNote:
      actionHandlers.onSaveCategoryNote
      || ((target: SavedBandTarget, updates: CategoryNoteUpdates) =>
        app.saveCategoryNote?.(target, updates)),
  };
  return createDesktopReactShell({ renderAdapter, actionHandlers: mergedActionHandlers });
}

/**
 * Everything the mount takes, minus the shell it builds itself.
 *
 * Spelled as an Omit rather than a hand-written list: the list version had to be
 * edited in three places for every new mount option — declare, destructure,
 * forward — and a missed one failed silently, since the mount treats absent
 * handlers as optional. That is how the account export and deletion handlers
 * came to be declared and never passed (#175).
 */
export type BootstrapDesktopReactAppOptions = Omit<DesktopReactMountOptions, "shell"> & {
  app: DesktopAppCollaborator;
  viewport?: string;
  actionHandlers?: Record<string, unknown>;
};


function bootstrapDesktopReactApp(options: BootstrapDesktopReactAppOptions) {
  const { app, viewport = "desktop", actionHandlers = {}, ...mountOptions } = options;
  const shell = bootstrapDesktopReactShell({ app, viewport, actionHandlers });
  const mountApi = createDesktopReactMount({ shell, ...mountOptions });
  return {
    ...mountApi,
    setViewport: (next: string) => shell.setViewport(next),
    refreshView() {
      return mountApi.mount();
    },
  };
}

export {
  bootstrapDesktopRenderAdapter,
  bootstrapDesktopReactShell,
  bootstrapDesktopReactApp,
};
