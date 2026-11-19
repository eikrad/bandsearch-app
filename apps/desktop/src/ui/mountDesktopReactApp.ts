import type { SavedBandTarget, CategoryNoteUpdates } from "../savedBandActions.js";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { ChatAppView } from "./ChatAppView.js";
import { SavedArtistsView } from "./SavedArtistsView.js";
import { SettingsView } from "./SettingsView.js";
import { PrivacyPolicyView } from "./PrivacyPolicyView.js";
import { WelcomeView } from "./WelcomeView.js";
import { LoginView } from "./LoginView.js";
import { RegisterView, type RegisterViewProps } from "./RegisterView.js";
import { ResetPasswordView } from "./ResetPasswordView.js";
import { UpdateBanner, type UpdateBannerViewProps } from "./UpdateBanner.js";
import { ConnectingView } from "./ConnectingView.js";
import type { UpdateBannerHandlers, ConnectingHandlers, ConnectingViewProps } from "./viewTypes.js";
import { openExternalLink } from "../openExternalLink.js";

/** The shell surface this mount drives; everything optional is guarded with `?.`. */
export type MountShell = {
  getViewProps(): unknown;
  updateMode(mode: string): Promise<unknown>;
  submitQuery(query: string): Promise<unknown> | unknown;
  saveBand?(target: SavedBandTarget): Promise<unknown> | unknown;
  rateBand?(target: SavedBandTarget, rating: number | null): Promise<unknown> | unknown;
  unsaveBand?(savedBandId: string, artistName: string): Promise<unknown> | unknown;
  saveCategoryNote?(
    target: SavedBandTarget,
    updates: CategoryNoteUpdates,
  ): Promise<unknown> | unknown;
  cancelSearch?(): void;
  retryLastSearch?(): Promise<unknown> | void;
  updateObscurityTarget?(target: string | undefined): unknown;
  submitFeedback?(feedbackType: string): Promise<unknown>;
  dismissFeedback?(): void;
  /** View props changed without a handler (a status message timing out). */
  subscribe?(listener: () => void): unknown;
};

// The mount dispatches to views with differing prop shapes, so prop types are
// deliberately erased at this one seam rather than throughout.
type ViewComponentLike = React.ComponentType<Record<string, unknown>>;

type MountRouter = {
  getRoute(): string;
  /** Must tell `onRouteChange` listeners before returning: the mount renders from that. */
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
  saveLlmApiKey?: (apiKey: string) => Promise<void>;
  saveBraveApiKey?: (apiKey: string) => Promise<void>;
  saveTursoConfig?: (url: string, token: string) => Promise<void>;
  clearTursoConfig?: () => Promise<void>;
  saveApiEndpointUrl?: (url: string) => Promise<void>;
  completeOnboarding?: () => Promise<void>;
  /**
   * Every way into the chat goes through here: the app session's auth gate in
   * the app. Absent (tests of single views), it is a plain navigation.
   */
  enterApp?: () => Promise<unknown>;
  onLogin?: (email: string, password: string) => Promise<void>;
  onRegister?: (email: string, displayName: string, password: string, inviteCode?: string) => Promise<{ recoveryCode: string }>;
  getRegisterViewProps?: () => RegisterViewProps;
  onResetPassword?: (email: string, recoveryCode: string, newPassword: string) => Promise<{ newRecoveryCode: string }>;
  onExportAccountData?: () => Promise<Record<string, unknown>>;
  onDeleteAccount?: (password: string) => Promise<{ ok: boolean; error?: string }>;
  updateBannerHandlers?: UpdateBannerHandlers;
  connectingHandlers?: ConnectingHandlers;
  getConnectingViewProps?: () => ConnectingViewProps;
  createRootImpl?: typeof createRoot;
  resolveContainer?: () => HTMLElement;
  openExternalLinkImpl?: (url: string) => unknown;
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
  saveLlmApiKey = async (apiKey) => { void apiKey; },
  saveBraveApiKey = async (apiKey) => { void apiKey; },
  saveTursoConfig = async (url, token) => { void url; void token; },
  clearTursoConfig = async () => {},
  onExportAccountData,
  onDeleteAccount,
  saveApiEndpointUrl = async (url) => { void url; },
  completeOnboarding = async () => {},
  enterApp: enterAppThroughGate,
  onLogin,
  onRegister,
  onResetPassword,
  updateBannerHandlers = {},
  connectingHandlers = {},
  getConnectingViewProps,
  getRegisterViewProps,
  createRootImpl = createRoot,
  resolveContainer = defaultContainerResolver,
  openExternalLinkImpl = openExternalLink,
}: DesktopReactMountOptions) {
  const container = resolveContainer();
  const root = createRootImpl(container);

  // Whether the saved screen has fetched since the route was last entered.
  let savedArtistsLoaded = false;
  // Set by showUpdateBanner; null means no banner is showing.
  let updateBannerViewProps: UpdateBannerViewProps | null = null;
  // The last routed element, so the banner can be toggled on top of it without
  // re-running the route — re-rendering `settings` would repeat its
  // llm_config_status IPC just to paint an overlay.
  let routedView: React.ReactNode = null;

  // Always the same Fragment shape, banner or not: rendering the bare view when
  // no banner is present would change the root element's shape the moment one
  // appears, and React would unmount and remount the whole routed view.
  function paint() {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        updateBannerViewProps &&
          React.createElement(UpdateBanner, { viewProps: updateBannerViewProps, handlers: updateBannerHandlers }),
        routedView,
      ),
    );
  }

  // Every route branch renders through here so the banner — when present —
  // stays layered above whichever view is routed, instead of each branch
  // needing to know about it.
  function renderRoot(nextRoutedView: React.ReactNode) {
    routedView = nextRoutedView;
    paint();
  }

  // Whether the chat view is what was last painted. Changes the shell reports
  // on its own repaint only the chat: re-rendering settings, for one, would
  // repeat its IPC just to clear a message nobody can see.
  let chatOnScreen = false;

  async function renderCurrent() {
    const route = router ? router.getRoute() : "home";
    if (route !== "saved") savedArtistsLoaded = false;
    chatOnScreen = false;

    if (route === "login") {
      renderRoot(React.createElement(LoginView as unknown as ViewComponentLike, { viewProps: {}, handlers: loginHandlers }));
      return {};
    }

    if (route === "register") {
      renderRoot(React.createElement(RegisterView as unknown as ViewComponentLike, { viewProps: getRegisterViewProps?.() ?? {}, handlers: registerHandlers }));
      return {};
    }

    if (route === "reset-password") {
      renderRoot(React.createElement(ResetPasswordView as unknown as ViewComponentLike, { viewProps: {}, handlers: resetPasswordHandlers }));
      return {};
    }

    if (route === "connecting") {
      renderRoot(
        React.createElement(ConnectingView as unknown as ViewComponentLike, {
          viewProps: getConnectingViewProps?.() ?? { state: "waiting" },
          handlers: connectingHandlers,
        }),
      );
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
      // Merged over the injected props so an account action can report itself.
      // The supplier owns LLM/Brave key status; nothing owned the outcome of an
      // export or a deletion, so both failed in silence.
      const supplied = await Promise.resolve(getSettingsViewProps()) as Record<string, unknown>;
      const viewProps = accountStatus ? { ...supplied, statusMessage: accountStatus } : supplied;
      renderRoot(
        React.createElement(SettingsView as unknown as ViewComponentLike, {
          viewProps,
          handlers: settingsHandlers,
        }),
      );
      return viewProps;
    }

    const viewProps = shell.getViewProps();
    chatOnScreen = true;
    renderRoot(React.createElement(ChatAppView as unknown as ViewComponentLike, { viewProps, handlers }));
    return viewProps;
  }

  shell.subscribe?.(() => {
    if (chatOnScreen) void renderCurrent();
  });

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
    onSave: async (target: SavedBandTarget) => {
      try {
        await shell.saveBand?.(target);
      } catch {
        // Error is surfaced via actionStatus in the shell; always re-render.
      }
      return renderCurrent();
    },
    // No default rating here — #153 was this call hardcoding 5 regardless of
    // what the user actually tapped. The star row always sends an explicit
    // value (a number, or null to clear).
    onRate: async (target: SavedBandTarget, rating: number | null) => {
      try {
        await shell.rateBand?.(target, rating);
      } catch {
        // Error is surfaced via actionStatus in the shell; always re-render.
      }
      return renderCurrent();
    },
    onUnsave: async (savedBandId: string, artistName: string) => {
      try {
        await shell.unsaveBand?.(savedBandId, artistName);
      } catch {
        // Error is surfaced via actionStatus in the shell; always re-render.
      }
      return renderCurrent();
    },
    onSaveCategoryNote: async (
      target: SavedBandTarget,
      updates: CategoryNoteUpdates,
    ) => {
      try {
        await shell.saveCategoryNote?.(target, updates);
      } catch {
        // Error is surfaced via actionStatus in the shell; always re-render.
      }
      return renderCurrent();
    },
    onOpenLink: (url: string) => {
      openExternalLinkImpl(url);
    },
    onObscurityTargetChange: (target: string | undefined) => {
      shell.updateObscurityTarget?.(target);
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
        // Error is surfaced via actionStatus in the shell; always re-render.
      }
      return renderCurrent();
    },
    onFeedback: async (feedbackType: string) => {
      try {
        const pending = shell.submitFeedback?.(feedbackType);
        // The bar closes on the click, not when the API answers.
        await renderCurrent();
        await pending;
      } catch {
        // Error is surfaced via actionStatus in the shell; always re-render.
      }
      return renderCurrent();
    },
    onFeedbackDismiss: () => {
      shell.dismissFeedback?.();
      return renderCurrent();
    },
    onNavigateSaved: async () => {
      // Route, not view flag: `route === "saved"` is what selects the shell
      // implementation below. Setting only the app's view flag left the hash on
      // "home" and quietly served a second, less capable copy of this screen.
      return go("saved");
    },
    onNavigateSettings: async () => {
      return go("settings");
    },
    onSaveTursoConfig: async (url: string, token: string) => {
      await saveTursoConfig(url, token);
      return renderCurrent();
    },
  };

  const settingsHandlers = {
    onNavigateChat: async () => {
      return enterApp();
    },
    onSaveApiKey: async (apiKey: string) => {
      await saveLlmApiKey(apiKey);
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
      return go("privacy");
    },
    // Left undefined when no collaborator was injected, rather than wrapped in a
    // function that silently returns. A present-but-inert handler is exactly how
    // #175 hid: the view could not tell the difference, so the button rendered
    // and did nothing. Absent, the view omits the control instead.
    onExportAccountData: !onExportAccountData ? undefined : async () => {
      // Same Blob + a.download path the saved-artists export already uses:
      // the Tauri webview blocks nothing here and it needs no new dependency.
      let bundle: Record<string, unknown>;
      try {
        bundle = await onExportAccountData();
      } catch (error) {
        // Previously this rejected into the click handler and surfaced as an
        // uncaught page error — the user saw nothing at all, on a control the
        // privacy policy points them at for Art. 15.
        accountStatus = { type: "error", message: error instanceof Error ? error.message : "export failed" };
        return renderCurrent();
      }
      accountStatus = null;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bandsearch-account-data.json";
      a.click();
      URL.revokeObjectURL(url);
    },
    onDeleteAccount: !onDeleteAccount ? undefined : async (password: string) => {
      const result = await onDeleteAccount(password);
      if (!result.ok) {
        // A wrong password used to redraw the screen unchanged, which reads as
        // "nothing happened" rather than "that password was wrong".
        accountStatus = { type: "error", message: result.error ?? "account deletion failed" };
        return renderCurrent();
      }
      accountStatus = null;
      // Where a signed-out user goes depends on who is left: Register on an
      // emptied personal install, Login on a shared one. The gate asks.
      return enterApp();
    },
  };

  // Outcome of the last export or deletion, shown in the privacy card.
  let accountStatus: { type: "success" | "error"; message: string } | null = null;

  const privacyHandlers = {
    onBack: async () => {
      return go("settings");
    },
  };

  const welcomeHandlers = {
    onGoToSettings: async () => {
      return go("settings");
    },
    onSkip: async () => {
      await completeOnboarding();
      return enterApp();
    },
  };

  const loginHandlers = {
    onLogin: async (email: string, password: string) => {
      if (onLogin) await onLogin(email, password);
      return enterApp();
    },
    onNavigateRegister: () => go("register"),
    onNavigateReset: () => go("reset-password"),
  };

  const registerHandlers = {
    onRegister: async (email: string, displayName: string, password: string, inviteCode?: string) => {
      const result = onRegister ? await onRegister(email, displayName, password, inviteCode) : { recoveryCode: "" };
      return result;
    },
    onDone: () => enterApp(),
    onNavigateLogin: () => go("login"),
  };

  const resetPasswordHandlers = {
    onResetPassword: async (email: string, recoveryCode: string, newPassword: string) => {
      const result = onResetPassword ? await onResetPassword(email, recoveryCode, newPassword) : { newRecoveryCode: "" };
      return result;
    },
    onDone: () => go("login"),
    onNavigateLogin: () => go("login"),
  };

  const savedHandlers = {
    onNavigate: (view: string) => {
      return view === "chat" ? enterApp() : render();
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
      return enterApp();
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

  // The router tells its listeners inside navigate(), so a navigation's render
  // is the one recorded here. Rendering again after navigating would paint the
  // same screen twice.
  let lastRender: ReturnType<typeof renderCurrent> = Promise.resolve({});
  function render() {
    lastRender = renderCurrent();
    return lastRender;
  }
  function go(route: string) {
    if (!router) return render();
    router.navigate(route);
    return lastRender;
  }
  async function enterApp() {
    if (!enterAppThroughGate) return go("home");
    await enterAppThroughGate();
    return lastRender;
  }

  if (router) {
    router.onRouteChange(() => { void render(); });
  }

  return {
    handlers,
    mount() {
      return renderCurrent();
    },
    showUpdateBanner(viewProps: UpdateBannerViewProps | null) {
      updateBannerViewProps = viewProps;
      paint();
    },
  };
}
