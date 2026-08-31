import { createChatRenderAdapter } from "./chatRenderAdapter.js";
import { createDesktopReactShell } from "./ui/createDesktopReactShell.js";
import { createDesktopReactMount } from "./ui/mountDesktopReactApp.js";
import type { DesktopReactMountOptions } from "./ui/mountDesktopReactApp.js";
import type { ChatAppCollaborator } from "./chatAppModel.js";
import type { ChatHandlers } from "./ui/viewTypes.js";
import { createDesktopChatUiStack } from "./desktopChatUiStack.js";
import { bootstrapDesktopApp } from "./bootstrapDesktopApp.js";

export { bootstrapDesktopApp };

/**
 * Everything index.ts asks of the bootstrapped app. Scoped to the chat screen —
 * the saved-artists screen states its own needs in `SavedArtistsShellCollaborator`
 * and is assembled in `startDesktopBrowserApp`, not here.
 */
type DesktopAppCollaborator = ChatAppCollaborator & {
  saveBand?(artistName: string): unknown;
  rateBand?(artistName: string, rating: number | null): unknown;
  deleteSavedBand?(savedBandId: string): unknown;
  saveCategoryNote?(
    artistName: string,
    savedBandId: string | null,
    updates: { categories: string[]; note: string },
  ): unknown;
};

function bootstrapDesktopUi(options: { app: DesktopAppCollaborator; viewport?: string }) {
  return createDesktopChatUiStack(options);
}

function bootstrapDesktopRenderAdapter({ app, viewport = "desktop" }: { app: DesktopAppCollaborator; viewport?: string }) {
  const desktopUi = bootstrapDesktopUi({ app, viewport });
  // The adapter carries the stack so the shell can reach cancel/retry.
  return Object.assign(createChatRenderAdapter({ desktopUi }), { desktopUi });
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
    onSave: actionHandlers.onSave || ((artistName: string) => app.saveBand?.(artistName)),
    // Forwards whatever rating the star row sent — no default here. A
    // hardcoded fallback is exactly how "Rate" used to always write 5 (#153).
    onRate:
      actionHandlers.onRate || ((artistName: string, rating: number | null) => app.rateBand?.(artistName, rating)),
    onUnsave:
      actionHandlers.onUnsave
      || ((savedBandId: string, artistName: string) => {
        void artistName;
        return app.deleteSavedBand?.(savedBandId);
      }),
    onSaveCategoryNote:
      actionHandlers.onSaveCategoryNote
      || ((artistName: string, savedBandId: string | null, updates: { categories: string[]; note: string }) =>
        app.saveCategoryNote?.(artistName, savedBandId, updates)),
  };
  const shell = createDesktopReactShell({
    renderAdapter,
    actionHandlers: mergedActionHandlers,
    cancelSearchImpl: () => renderAdapter.desktopUi.cancelSearch(),
    retryLastSearchImpl: () => renderAdapter.desktopUi.retryLastSearch(),
  });
  shell.desktopUi = renderAdapter.desktopUi;
  return shell;
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
    desktopUi: shell.desktopUi,
    refreshView() {
      return mountApi.mount();
    },
  };
}

export {
  bootstrapDesktopUi,
  bootstrapDesktopRenderAdapter,
  bootstrapDesktopReactShell,
  bootstrapDesktopReactApp,
};
