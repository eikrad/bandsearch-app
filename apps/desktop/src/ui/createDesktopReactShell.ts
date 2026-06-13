import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatAppView } from "./ChatAppView.js";
import { ObscurityTargetPicker } from "./ObscurityTargetPicker.js";
import { formatRecommendationQueryError } from "../apiErrorMessages.js";

type ActionStatus = { type: "success" | "error"; message: string } | null;

interface CreateDesktopReactShellOptions {
  renderAdapter: {
    onModeChange: (mode: string) => any;
    onSubmitQuery: (query: string) => any;
    onObscurityTargetChange?: (target: string | undefined) => any;
    getViewProps: () => Record<string, any>;
  };
  actionHandlers?: Record<string, any>;
  statusTimeoutMs?: number;
  errorStatusTimeoutMs?: number;
  setTimeoutImpl?: typeof setTimeout;
  getViewImpl?: () => string;
  navigateImpl?: (view: string) => any;
  searchArtistsImpl?: (query: string) => Promise<void>;
  toggleSelectionImpl?: (id: string) => void;
  deleteSavedArtistImpl?: (id: string) => Promise<void>;
  activateStyleRefImpl?: () => Promise<void>;
  getSavedArtistsViewPropsImpl?: () => Record<string, any>;
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
  }),
  cancelSearchImpl,
  retryLastSearchImpl,
}: CreateDesktopReactShellOptions) {
  let actionStatus: ActionStatus = null;
  let clearStatusTimer: ReturnType<typeof setTimeout> | null = null;

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
    desktopUi: undefined as any,
    getViewProps() {
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
        throw new Error("query failed");
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
      return renderToStaticMarkup(React.createElement(ChatAppView as any, { viewProps, handlers }));
    },
  };
  return shell;
}
