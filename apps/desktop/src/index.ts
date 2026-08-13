import { createChatRenderAdapter } from "./chatRenderAdapter.js";
import { createSavedArtistsModel } from "./savedArtistsModel.js";
import { createDesktopReactShell } from "./ui/createDesktopReactShell.js";
import { createDesktopReactMount } from "./ui/mountDesktopReactApp.js";
import type { DesktopReactMountOptions } from "./ui/mountDesktopReactApp.js";
import type { ChatAppCollaborator } from "./chatAppModel.js";
import type { SavedArtistsCollaborator } from "./savedArtistsModel.js";
import type { ChatHandlers } from "./ui/viewTypes.js";
import { createDesktopChatUiStack } from "./desktopChatUiStack.js";
import { bootstrapDesktopApp } from "./bootstrapDesktopApp.js";

export { bootstrapDesktopApp };

/** Everything index.ts asks of the bootstrapped app, across both screens. */
type DesktopAppCollaborator = ChatAppCollaborator &
  SavedArtistsCollaborator & {
    getView?(): string;
    navigate?(view: string): unknown;
    saveBand?(artistName: string): unknown;
    rateBand?(artistName: string, rating?: number): unknown;
    setPendingStyleRef?(ids: string[]): void;
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
  const savedArtistsModel = createSavedArtistsModel({ app });
  const mergedActionHandlers = {
    onSave: actionHandlers.onSave || ((artistName: string) => app.saveBand?.(artistName)),
    onRate: actionHandlers.onRate || ((artistName: string) => app.rateBand?.(artistName, 5)),
    onMore: actionHandlers.onMore || (() => {}),
  };
  const shell = createDesktopReactShell({
    renderAdapter,
    actionHandlers: mergedActionHandlers,
    getViewImpl: () => app.getView?.() ?? "chat",
    navigateImpl: async (view: string) => {
      app.navigate?.(view);
      if (view === "saved-artists") {
        await savedArtistsModel.loadSavedArtists();
      }
    },
    searchArtistsImpl: (query: string) => savedArtistsModel.searchArtists(query),
    toggleSelectionImpl: (id: string) => savedArtistsModel.toggleSelection(id),
    deleteSavedArtistImpl: (id: string) => savedArtistsModel.deleteSavedArtist(id),
    activateStyleRefImpl: async () => {
      const ids = savedArtistsModel.getSelectedIds();
      savedArtistsModel.clearSelection();
      app.setPendingStyleRef?.(ids);
      app.navigate?.("chat");
    },
    getSavedArtistsViewPropsImpl: () => savedArtistsModel.getScreenState(),
    cancelSearchImpl: () => renderAdapter.desktopUi.cancelSearch(),
    retryLastSearchImpl: () => renderAdapter.desktopUi.retryLastSearch(),
  });
  shell.desktopUi = renderAdapter.desktopUi;
  return shell;
}

export type BootstrapDesktopReactAppOptions = {
  app: DesktopAppCollaborator;
  viewport?: string;
  actionHandlers?: Record<string, unknown>;
  router?: DesktopReactMountOptions["router"];
  savedArtistsShell?: DesktopReactMountOptions["savedArtistsShell"];
  getSettingsViewProps?: () => Promise<unknown>;
  saveGeminiApiKey?: (apiKey: string) => Promise<void>;
  saveBraveApiKey?: (apiKey: string) => Promise<void>;
  saveTursoConfig?: (url: string, token: string) => Promise<void>;
  clearTursoConfig?: () => Promise<void>;
  saveApiEndpointUrl?: (url: string) => Promise<void>;
  completeOnboarding?: () => Promise<void>;
  onLogin?: (email: string, password: string) => Promise<void>;
  onRegister?: (email: string, displayName: string, password: string) => Promise<{ recoveryCode: string }>;
  onResetPassword?: (email: string, recoveryCode: string, newPassword: string) => Promise<{ newRecoveryCode: string }>;
};

function bootstrapDesktopReactApp(options: BootstrapDesktopReactAppOptions) {
  const {
    app,
    viewport = "desktop",
    actionHandlers = {},
    router = null,
    savedArtistsShell = null,
    getSettingsViewProps,
    saveGeminiApiKey,
    saveBraveApiKey,
    saveTursoConfig,
    clearTursoConfig,
    saveApiEndpointUrl,
    completeOnboarding,
    onLogin,
    onRegister,
    onResetPassword,
  } = options;
  const shell = bootstrapDesktopReactShell({ app, viewport, actionHandlers });
  const mountApi = createDesktopReactMount({
    shell,
    router,
    savedArtistsShell,
    getSettingsViewProps,
    saveGeminiApiKey,
    saveBraveApiKey,
    saveTursoConfig,
    clearTursoConfig,
    saveApiEndpointUrl,
    completeOnboarding,
    onLogin,
    onRegister,
    onResetPassword,
  });
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
