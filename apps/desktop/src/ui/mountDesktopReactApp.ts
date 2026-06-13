import * as React from "react";
import { createRoot } from "react-dom/client";
import { ChatAppView } from "./ChatAppView.js";
import { SavedArtistsView } from "./SavedArtistsView.js";
import { SettingsView } from "./SettingsView.js";
import { WelcomeView } from "./WelcomeView.js";
import { LoginView } from "./LoginView.js";
import { RegisterView } from "./RegisterView.js";
import { ResetPasswordView } from "./ResetPasswordView.js";

type AnyShell = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRouter = any;
type AnySavedShell = Record<string, any> | null;

function defaultContainerResolver(): HTMLElement {
  const browserDocument = globalThis.document as Document | undefined;
  const root = browserDocument?.getElementById("root");
  if (!root) throw new Error("missing root container");
  return root;
}

function resolveViewComponent(viewName: string) {
  if (viewName === "saved-artists") return SavedArtistsView;
  return ChatAppView;
}

export interface DesktopReactMountOptions {
  shell: AnyShell;
  router?: AnyRouter;
  savedArtistsShell?: AnySavedShell;
  getSettingsViewProps?: () => any;
  saveGeminiApiKey?: (apiKey: string) => Promise<void>;
  saveBraveApiKey?: (apiKey: string) => Promise<void>;
  saveTursoConfig?: (url: string, token: string) => Promise<void>;
  clearTursoConfig?: () => Promise<void>;
  completeOnboarding?: () => Promise<void>;
  onLogin?: (email: string, password: string) => Promise<void>;
  onRegister?: (email: string, displayName: string, password: string) => Promise<{ recoveryCode: string }>;
  onResetPassword?: (email: string, recoveryCode: string, newPassword: string) => Promise<{ newRecoveryCode: string }>;
  createRootImpl?: typeof createRoot;
  resolveContainer?: () => HTMLElement;
}

export function createDesktopReactMount({
  shell,
  router = null,
  savedArtistsShell = null,
  getSettingsViewProps = () => ({
    headerTitle: "Settings",
    headerSubtitle: "",
    hasStoredKey: false,
    hasBraveKey: false,
    statusMessage: null,
  }),
  saveGeminiApiKey = async (apiKey) => { void apiKey; },
  saveBraveApiKey = async (apiKey) => { void apiKey; },
  saveTursoConfig = async (url, token) => { void url; void token; },
  clearTursoConfig = async () => {},
  completeOnboarding = async () => {},
  onLogin,
  onRegister,
  onResetPassword,
  createRootImpl = createRoot,
  resolveContainer = defaultContainerResolver,
}: DesktopReactMountOptions) {
  const container = resolveContainer();
  const root = createRootImpl(container);

  async function renderCurrent() {
    const route = router ? router.getRoute() : "home";

    if (route === "login") {
      root.render(React.createElement(LoginView as any, { viewProps: {}, handlers: loginHandlers }));
      return {};
    }

    if (route === "register") {
      root.render(React.createElement(RegisterView as any, { viewProps: {}, handlers: registerHandlers }));
      return {};
    }

    if (route === "reset-password") {
      root.render(React.createElement(ResetPasswordView as any, { viewProps: {}, handlers: resetPasswordHandlers }));
      return {};
    }

    if (route === "welcome") {
      root.render(
        React.createElement(WelcomeView as any, {
          viewProps: {},
          handlers: welcomeHandlers,
        }),
      );
      return {};
    }

    if (route === "saved" && savedArtistsShell) {
      const viewProps = savedArtistsShell.getViewProps();
      root.render(
        React.createElement(SavedArtistsView as any, {
          viewProps,
          handlers: savedHandlers,
        }),
      );
      return viewProps;
    }

    if (route === "settings") {
      const viewProps = await Promise.resolve(getSettingsViewProps());
      root.render(
        React.createElement(SettingsView as any, {
          viewProps,
          handlers: settingsHandlers,
        }),
      );
      return viewProps;
    }

    const viewProps = shell.getViewProps();
    const currentView = shell.getView?.() ?? "chat";
    const ViewComponent = resolveViewComponent(currentView);
    root.render(React.createElement(ViewComponent as any, { viewProps, handlers }));
    return viewProps;
  }

  const handlers = {
    onModeChange: async (mode: string) => {
      await shell.updateMode(mode);
      return renderCurrent();
    },
    onQuerySubmit: async (query: string) => {
      try {
        const pending = shell.submitQuery(query);
        await renderCurrent();
        await pending;
      } catch {
        // Error is surfaced via actionStatus in the shell; always re-render.
      }
      return renderCurrent();
    },
    onSave: (artistName: string) => {
      return Promise.resolve(shell.saveBand?.(artistName)).then(() => renderCurrent());
    },
    onRate: (artistName: string) => {
      return Promise.resolve(shell.rateBand?.(artistName, 5)).then(() => renderCurrent());
    },
    onMore: (artistName: string) => {
      void artistName;
    },
    onObscurityTargetChange: (target: string | undefined) => {
      shell.desktopUi?.setObscurityTarget?.(target);
      return renderCurrent();
    },
    onDelete: async (id: string) => {
      try {
        await shell.deleteSavedArtist?.(id);
      } catch {
        // Error surfaced via actionStatus
      }
      return renderCurrent();
    },
    onToggleSelection: (id: string) => {
      shell.toggleSelection?.(id);
      return renderCurrent();
    },
    onActivateStyleRef: async () => {
      await shell.activateStyleRef?.();
      return renderCurrent();
    },
    onSearch: async (query: string) => {
      await shell.searchArtists?.(query);
      return renderCurrent();
    },
    onAddArtist: async ({ name }: { name: string }) => {
      try {
        await shell.saveBand?.(name);
      } catch {
        // Error surfaced via actionStatus
      }
      return renderCurrent();
    },
    onNavigate: async (view: string) => {
      await shell.navigate?.(view);
      return renderCurrent();
    },
    onNavigateSaved: async () => {
      await shell.navigate?.("saved-artists");
      return renderCurrent();
    },
    onNavigateSettings: async () => {
      if (router) router.navigate("settings");
      return renderCurrent();
    },
    onSaveTursoConfig: async (url: string, token: string) => {
      await saveTursoConfig(url, token);
      return renderCurrent();
    },
  };

  const settingsHandlers = {
    onNavigateChat: async () => {
      if (router) router.navigate("home");
      return renderCurrent();
    },
    onSaveApiKey: async (apiKey: string) => {
      await saveGeminiApiKey(apiKey);
      return renderCurrent();
    },
    onSaveBraveApiKey: async (apiKey: string) => {
      await saveBraveApiKey(apiKey);
      return renderCurrent();
    },
    onSaveTursoConfig: handlers.onSaveTursoConfig,
    onClearTursoConfig: async () => {
      await clearTursoConfig();
      return renderCurrent();
    },
  };

  const welcomeHandlers = {
    onGoToSettings: async () => {
      if (router) router.navigate("settings");
      return renderCurrent();
    },
    onSkip: async () => {
      await completeOnboarding();
      if (router) router.navigate("home");
      return renderCurrent();
    },
  };

  const loginHandlers = {
    onLogin: async (email: string, password: string) => {
      if (onLogin) await onLogin(email, password);
      if (router) router.navigate("home");
      return renderCurrent();
    },
    onNavigateRegister: () => { if (router) router.navigate("register"); renderCurrent(); },
    onNavigateReset: () => { if (router) router.navigate("reset-password"); renderCurrent(); },
  };

  const registerHandlers = {
    onRegister: async (email: string, displayName: string, password: string) => {
      const result = onRegister ? await onRegister(email, displayName, password) : { recoveryCode: "" };
      return result;
    },
    onDone: () => { if (router) router.navigate("home"); renderCurrent(); },
    onNavigateLogin: () => { if (router) router.navigate("login"); renderCurrent(); },
  };

  const resetPasswordHandlers = {
    onResetPassword: async (email: string, recoveryCode: string, newPassword: string) => {
      const result = onResetPassword ? await onResetPassword(email, recoveryCode, newPassword) : { newRecoveryCode: "" };
      return result;
    },
    onDone: () => { if (router) router.navigate("login"); renderCurrent(); },
    onNavigateLogin: () => { if (router) router.navigate("login"); renderCurrent(); },
  };

  const savedHandlers = {
    onNavigate: (view: string) => {
      if (view === "chat" && router) router.navigate("home");
      renderCurrent();
    },
    onToggleSelection: (id: string) => {
      savedArtistsShell?.toggleArtistSelection(id);
      renderCurrent();
    },
    onSearch: async (query: string) => {
      savedArtistsShell?.setSearchQuery(query);
      await savedArtistsShell?.searchArtists();
      renderCurrent();
    },
    onAddArtist: (artist: any) => {
      Promise.resolve(savedArtistsShell?.addArtist(artist)).then(() => renderCurrent());
    },
    onDelete: async (id: string) => {
      await savedArtistsShell?.deleteSavedArtist?.(id);
      renderCurrent();
    },
    onActivateStyleRef: async () => {},
    onExport: async () => {
      const bands = await savedArtistsShell?.exportArtists?.();
      if (!bands) return;
      const blob = new Blob([JSON.stringify(bands, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bandsearch-artists.json";
      a.click();
      URL.revokeObjectURL(url);
    },
    onImportFile: async (file: File) => {
      try {
        const text = await file.text();
        const bands = JSON.parse(text);
        await savedArtistsShell?.importArtists?.(bands);
        renderCurrent();
      } catch {
        // file read or parse error — silently ignore for now
      }
    },
    onCreateGroup: async (name: string) => {
      await savedArtistsShell?.createGroup?.(name);
      renderCurrent();
    },
    onDeleteGroup: async (id: string) => {
      await savedArtistsShell?.deleteGroup?.(id);
      renderCurrent();
    },
    onAutoGroup: async () => {
      await savedArtistsShell?.autoGroup?.();
      renderCurrent();
    },
  };

  if (router) {
    router.onRouteChange(() => renderCurrent());
  }

  return {
    handlers,
    mount() {
      return renderCurrent();
    },
  };
}
