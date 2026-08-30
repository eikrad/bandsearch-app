import * as React from "react";
import { createRoot } from "react-dom/client";
import { ChatAppView } from "./ChatAppView.js";
import { SavedArtistsView } from "./SavedArtistsView.js";
import { SettingsView } from "./SettingsView.js";
import { PrivacyPolicyView } from "./PrivacyPolicyView.js";
import { WelcomeView } from "./WelcomeView.js";
import { LoginView } from "./LoginView.js";
import { RegisterView } from "./RegisterView.js";
import { ResetPasswordView } from "./ResetPasswordView.js";
import { UpdateBanner, type UpdateBannerViewProps } from "./UpdateBanner.js";
import type { UpdateBannerHandlers } from "./viewTypes.js";

/** The shell surface this mount drives; everything optional is guarded with `?.`. */
export type MountShell = {
  getViewProps(): unknown;
  updateMode(mode: string): Promise<unknown>;
  submitQuery(query: string): Promise<unknown> | unknown;
  saveBand?(artistName: string): Promise<unknown> | unknown;
  rateBand?(artistName: string, rating?: number): Promise<unknown> | unknown;
  cancelSearch?(): void;
  retryLastSearch?(): Promise<unknown> | void;
  desktopUi?: { setObscurityTarget?(target: string | undefined): void } | undefined;
};

// The mount dispatches to views with differing prop shapes, so prop types are
// deliberately erased at this one seam rather than throughout.
type ViewComponentLike = React.ComponentType<Record<string, unknown>>;

type MountRouter = {
  getRoute(): string;
  navigate(route: string): void;
  onRouteChange(listener: () => void): unknown;
};
type MountSavedShell = {
  getViewProps(): unknown;
  loadSavedArtists?(): Promise<unknown>;
  toggleArtistSelection(id: string): void;
  setSearchQuery(query: string): void;
  searchArtists(): Promise<unknown>;
  addArtist(artist: { id: string; name: string; disambiguation?: string }): Promise<unknown> | unknown;
  deleteSavedArtist?(id: string): Promise<unknown>;
  activateStyleRef?(): Promise<unknown>;
  exportArtists?(): Promise<unknown[] | undefined>;
  importArtists?(bands: unknown[]): Promise<unknown>;
  createGroup?(name: string): Promise<unknown>;
  deleteGroup?(id: string): Promise<unknown>;
  autoGroup?(): Promise<unknown>;
} | null;

function defaultContainerResolver(): HTMLElement {
  const browserDocument = globalThis.document as Document | undefined;
  const root = browserDocument?.getElementById("root");
  if (!root) throw new Error("missing root container");
  return root;
}

export interface DesktopReactMountOptions {
  shell: MountShell;
  router?: MountRouter | null;
  savedArtistsShell?: MountSavedShell | null;
  getSettingsViewProps?: () => unknown;
  saveGeminiApiKey?: (apiKey: string) => Promise<void>;
  saveBraveApiKey?: (apiKey: string) => Promise<void>;
  saveTursoConfig?: (url: string, token: string) => Promise<void>;
  clearTursoConfig?: () => Promise<void>;
  saveApiEndpointUrl?: (url: string) => Promise<void>;
  completeOnboarding?: () => Promise<void>;
  onLogin?: (email: string, password: string) => Promise<void>;
  onRegister?: (email: string, displayName: string, password: string) => Promise<{ recoveryCode: string }>;
  onResetPassword?: (email: string, recoveryCode: string, newPassword: string) => Promise<{ newRecoveryCode: string }>;
  onExportAccountData?: () => Promise<Record<string, unknown>>;
  onDeleteAccount?: (password: string) => Promise<{ ok: boolean; error?: string }>;
  updateBannerHandlers?: UpdateBannerHandlers;
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
  onExportAccountData,
  onDeleteAccount,
  saveApiEndpointUrl = async (url) => { void url; },
  completeOnboarding = async () => {},
  onLogin,
  onRegister,
  onResetPassword,
  updateBannerHandlers = {},
  createRootImpl = createRoot,
  resolveContainer = defaultContainerResolver,
}: DesktopReactMountOptions) {
  const container = resolveContainer();
  const root = createRootImpl(container);

  // Whether the saved screen has fetched since the route was last entered.
  let savedArtistsLoaded = false;
  // Set by showUpdateBanner; null means no banner is showing.
  let updateBannerViewProps: UpdateBannerViewProps | null = null;

  // Every route branch renders through here so the banner — when present —
  // stays layered above whichever view is routed, instead of each branch
  // needing to know about it.
  function renderRoot(routedView: React.ReactNode) {
    if (!updateBannerViewProps) {
      root.render(routedView);
      return;
    }
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(UpdateBanner, { viewProps: updateBannerViewProps, handlers: updateBannerHandlers }),
        routedView,
      ),
    );
  }

  async function renderCurrent() {
    const route = router ? router.getRoute() : "home";
    if (route !== "saved") savedArtistsLoaded = false;

    if (route === "login") {
      renderRoot(React.createElement(LoginView as unknown as ViewComponentLike, { viewProps: {}, handlers: loginHandlers }));
      return {};
    }

    if (route === "register") {
      renderRoot(React.createElement(RegisterView as unknown as ViewComponentLike, { viewProps: {}, handlers: registerHandlers }));
      return {};
    }

    if (route === "reset-password") {
      renderRoot(React.createElement(ResetPasswordView as unknown as ViewComponentLike, { viewProps: {}, handlers: resetPasswordHandlers }));
      return {};
    }

    if (route === "welcome") {
      renderRoot(
        React.createElement(WelcomeView as unknown as ViewComponentLike, {
          viewProps: {},
          handlers: welcomeHandlers,
        }),
      );
      return {};
    }

    if (route === "saved" && savedArtistsShell) {
      // Fetch on entry to the route, not in the navigation handler: the route is
      // also entered by reload and deep link, which never touch that handler.
      // Mutations re-render while already on the route and reload themselves, so
      // the flag keeps those from refetching twice.
      if (!savedArtistsLoaded) {
        savedArtistsLoaded = true;
        await savedArtistsShell.loadSavedArtists?.();
      }
      const viewProps = savedArtistsShell.getViewProps();
      renderRoot(
        React.createElement(SavedArtistsView as unknown as ViewComponentLike, {
          viewProps,
          handlers: savedHandlers,
        }),
      );
      return viewProps;
    }

    if (route === "privacy") {
      renderRoot(
        React.createElement(PrivacyPolicyView as unknown as ViewComponentLike, {
          viewProps: {},
          handlers: privacyHandlers,
        }),
      );
      return {};
    }

    if (route === "settings") {
      const viewProps = await Promise.resolve(getSettingsViewProps());
      renderRoot(
        React.createElement(SettingsView as unknown as ViewComponentLike, {
          viewProps,
          handlers: settingsHandlers,
        }),
      );
      return viewProps;
    }

    const viewProps = shell.getViewProps();
    renderRoot(React.createElement(ChatAppView as unknown as ViewComponentLike, { viewProps, handlers }));
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
    onStop: () => {
      shell.cancelSearch?.();
      return renderCurrent();
    },
    onRetry: async () => {
      try {
        const pending = shell.retryLastSearch?.();
        await renderCurrent();
        if (pending) await pending;
      } catch {
        // error surfaced via actionStatus
      }
      return renderCurrent();
    },
    onNavigateSaved: async () => {
      // Route, not view flag: `route === "saved"` is what selects the shell
      // implementation below. Setting only the app's view flag left the hash on
      // "home" and quietly served a second, less capable copy of this screen.
      if (router) router.navigate("saved");
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
    onSaveApiEndpointUrl: async (url: string) => {
      await saveApiEndpointUrl(url);
      return renderCurrent();
    },
    onNavigatePrivacy: async () => {
      if (router) router.navigate("privacy");
      return renderCurrent();
    },
    onExportAccountData: async () => {
      if (!onExportAccountData) return;
      // Same Blob + a.download path the saved-artists export already uses:
      // the Tauri webview blocks nothing here and it needs no new dependency.
      const bundle = await onExportAccountData();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bandsearch-account-data.json";
      a.click();
      URL.revokeObjectURL(url);
    },
    onDeleteAccount: async (password: string) => {
      if (!onDeleteAccount) return;
      const result = await onDeleteAccount(password);
      if (!result.ok) return renderCurrent();
      // Erasing the only account puts the install back to zero users, which is
      // the first-run state — so send them where a fresh install starts.
      if (router) router.navigate("register");
      return renderCurrent();
    },
  };

  const privacyHandlers = {
    onBack: async () => {
      if (router) router.navigate("settings");
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
    onAddArtist: (artist: { id: string; name: string; disambiguation?: string }) => {
      Promise.resolve(savedArtistsShell?.addArtist(artist)).then(() => renderCurrent());
    },
    onDelete: async (id: string) => {
      await savedArtistsShell?.deleteSavedArtist?.(id);
      renderCurrent();
    },
    onActivateStyleRef: async () => {
      await savedArtistsShell?.activateStyleRef?.();
      if (router) router.navigate("home");
      renderCurrent();
    },
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
    showUpdateBanner(viewProps: UpdateBannerViewProps | null) {
      updateBannerViewProps = viewProps;
      return renderCurrent();
    },
  };
}
