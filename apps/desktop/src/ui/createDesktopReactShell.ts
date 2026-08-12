import type { ChatViewProps } from "../chatRenderAdapter.js";
import type { DesktopChatUiStack } from "../desktopChatUiStack.js";
import type { SavedArtistsScreenState } from "../savedArtistsModel.js";
import type { ChatHandlers } from "./viewTypes.js";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatAppView } from "./ChatAppView.js";
import { formatRecommendationQueryError } from "../apiErrorMessages.js";

type ActionStatus = { type: "success" | "error"; message: string } | null;

/** Node returns a Timeout, browsers and test fakes return a number. */
type TimerHandle = ReturnType<typeof setTimeout> | number;

interface CreateDesktopReactShellOptions {
  renderAdapter: {
    onModeChange: (mode: string) => unknown;
    onSubmitQuery: (query: string) => unknown;
    onObscurityTargetChange?: (target: string | undefined) => unknown;
    getViewProps: () => ChatViewProps;
  };
  actionHandlers?: Partial<ChatHandlers>;
  statusTimeoutMs?: number;
  errorStatusTimeoutMs?: number;
  // Only "schedule this callback, give me a handle I can cancel" is used, so
  // the seam does not need the full setTimeout signature (which drags in
  // __promisify__ and forces fakes to be Node Timeouts).
  setTimeoutImpl?: (handler: () => void, timeout: number) => TimerHandle;
  getViewImpl?: () => string;
  navigateImpl?: (view: string) => unknown;
  searchArtistsImpl?: (query: string) => Promise<void>;
  toggleSelectionImpl?: (id: string) => void;
  deleteSavedArtistImpl?: (id: string) => Promise<void>;
  activateStyleRefImpl?: () => Promise<void>;
  getSavedArtistsViewPropsImpl?: () => SavedArtistsScreenState;
  cancelSearchImpl?: () => void;
  retryLastSearchImpl?: () => Promise<unknown> | void;
}

export function createDesktopReactShell({
  renderAdapter,
  actionHandlers = {},
  statusTimeoutMs = 3000,
  errorStatusTimeoutMs = 10000,
  setTimeoutImpl = setTimeout,
  getViewImpl = () => "chat",
  navigateImpl = () => {},
  searchArtistsImpl = async () => {},
  toggleSelectionImpl = () => {},
  deleteSavedArtistImpl = async () => {},
  activateStyleRefImpl = async () => {},
  getSavedArtistsViewPropsImpl = () => ({
    header: { title: "Saved Artists", subtitle: "Your style references" },
    artists: [],
    isLoading: false,
    selectedCount: 0,
    searchResults: [],
    isSearching: false,
    groups: [],
  }),
  cancelSearchImpl,
  retryLastSearchImpl,
}: CreateDesktopReactShellOptions) {
  let actionStatus: ActionStatus = null;
  let clearStatusTimer: TimerHandle | null = null;

  function scheduleStatusClear(customDelayMs?: number) {
    const delayMs = typeof customDelayMs === "number" ? customDelayMs : statusTimeoutMs;
    if (clearStatusTimer) clearTimeout(clearStatusTimer);
    clearStatusTimer = setTimeoutImpl(() => {
      actionStatus = null;
      clearStatusTimer = null;
    }, delayMs);
  }

  const handlers = {
    onModeChange: (mode: string) => renderAdapter.onModeChange(mode),
    onQuerySubmit: (query: string) => renderAdapter.onSubmitQuery(query),
    onObscurityTargetChange: (target: string | undefined) => renderAdapter.onObscurityTargetChange?.(target),
    onSave: actionHandlers.onSave || (() => {}),
    onRate: actionHandlers.onRate || (() => {}),
    onMore: actionHandlers.onMore || (() => {}),
  };

  const shell = {
    desktopUi: undefined as DesktopChatUiStack | undefined,
    getViewProps(): (ChatViewProps | SavedArtistsScreenState) & { actionStatus?: ActionStatus } {
      if (getViewImpl() === "saved-artists") {
        return getSavedArtistsViewPropsImpl();
      }
      const base = renderAdapter.getViewProps();
      return { ...base, actionStatus };
    },
    async updateMode(mode: string) {
      return handlers.onModeChange(mode);
    },
    async submitQuery(query: string) {
      try {
        return await handlers.onQuerySubmit(query);
      } catch (error) {
        actionStatus = { type: "error", message: formatRecommendationQueryError(error) };
        scheduleStatusClear(errorStatusTimeoutMs);
        throw new Error("query failed", { cause: error });
      }
    },
    async saveBand(artistName: string) {
      try {
        const result = await handlers.onSave(artistName);
        actionStatus = { type: "success", message: `Saved ${artistName}.` };
        scheduleStatusClear();
        return result;
      } catch (error) {
        actionStatus = { type: "error", message: `Save failed for ${artistName}.` };
        scheduleStatusClear();
        throw error;
      }
    },
    async rateBand(artistName: string, rating = 5) {
      try {
        const result = await handlers.onRate(artistName, rating);
        actionStatus = { type: "success", message: `Rated ${artistName}: ${rating}/5.` };
        scheduleStatusClear();
        return result;
      } catch (error) {
        actionStatus = { type: "error", message: `Rating failed for ${artistName}.` };
        scheduleStatusClear();
        throw error;
      }
    },
    getView() {
      return getViewImpl();
    },
    async navigate(view: string) {
      await navigateImpl(view);
    },
    async searchArtists(query: string) {
      await searchArtistsImpl(query);
    },
    toggleSelection(id: string) {
      toggleSelectionImpl(id);
    },
    async deleteSavedArtist(id: string) {
      try {
        await deleteSavedArtistImpl(id);
      } catch (error) {
        actionStatus = { type: "error", message: "Could not delete artist." };
        scheduleStatusClear();
        throw error;
      }
    },
    async activateStyleRef() {
      await activateStyleRefImpl();
    },
    cancelSearch() {
      cancelSearchImpl?.();
    },
    async retryLastSearch() {
      return retryLastSearchImpl?.();
    },
    renderHtml() {
      const viewProps = renderAdapter.getViewProps();
      return renderToStaticMarkup(React.createElement(ChatAppView, { viewProps, handlers }));
    },
  };
  return shell;
}
