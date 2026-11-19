import type { SavedBandTarget, CategoryNoteUpdates } from "../savedBandActions.js";
import type { ChatViewProps } from "../chatRenderAdapter.js";
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
    onRetrySearch?: () => unknown;
    onCancelSearch?: () => unknown;
    onFeedback?: (feedbackType: string) => unknown;
    onFeedbackDismiss?: () => unknown;
    setViewport?: (viewport: string) => void;
    getViewProps: () => ChatViewProps;
  };
  actionHandlers?: Partial<ChatHandlers>;
  statusTimeoutMs?: number;
  errorStatusTimeoutMs?: number;
  // Only "schedule this callback, give me a handle I can cancel" is used, so
  // the seam does not need the full setTimeout signature (which drags in
  // __promisify__ and forces fakes to be Node Timeouts).
  setTimeoutImpl?: (handler: () => void, timeout: number) => TimerHandle;
}

export function createDesktopReactShell({
  renderAdapter,
  actionHandlers = {},
  statusTimeoutMs = 3000,
  errorStatusTimeoutMs = 10000,
  setTimeoutImpl = setTimeout,
}: CreateDesktopReactShellOptions) {
  let actionStatus: ActionStatus = null;
  let clearStatusTimer: TimerHandle | null = null;
  // Who to tell when the view props change on their own, without a user
  // action whose handler re-renders anyway. Today that is only the status timer.
  const changeListeners = new Set<() => void>();

  function scheduleStatusClear(customDelayMs?: number) {
    const delayMs = typeof customDelayMs === "number" ? customDelayMs : statusTimeoutMs;
    if (clearStatusTimer) clearTimeout(clearStatusTimer);
    clearStatusTimer = setTimeoutImpl(() => {
      actionStatus = null;
      clearStatusTimer = null;
      for (const listener of changeListeners) listener();
    }, delayMs);
  }

  /**
   * Search and Retry fail the same way: an inline error the user can act on.
   * A stopped search is not a failure — the model settles it without an error.
   */
  async function runSearch(start: () => unknown) {
    try {
      return await start();
    } catch (error) {
      actionStatus = { type: "error", message: formatRecommendationQueryError(error) };
      scheduleStatusClear(errorStatusTimeoutMs);
      throw new Error("query failed", { cause: error });
    }
  }

  const handlers = {
    onModeChange: (mode: string) => renderAdapter.onModeChange(mode),
    onQuerySubmit: (query: string) => renderAdapter.onSubmitQuery(query),
    onObscurityTargetChange: (target: string | undefined) => renderAdapter.onObscurityTargetChange?.(target),
    onSave: actionHandlers.onSave || (() => {}),
    onRate: actionHandlers.onRate || (() => {}),
    onUnsave: actionHandlers.onUnsave || (() => {}),
    onSaveCategoryNote: actionHandlers.onSaveCategoryNote || (() => {}),
  };

  const shell = {
    /** Calls `listener` when the view props change outside a handler. Returns an unsubscribe. */
    subscribe(listener: () => void) {
      changeListeners.add(listener);
      return () => { changeListeners.delete(listener); };
    },
    getViewProps(): ChatViewProps & { actionStatus?: ActionStatus } {
      const base = renderAdapter.getViewProps();
      return { ...base, actionStatus };
    },
    async updateMode(mode: string) {
      return handlers.onModeChange(mode);
    },
    updateObscurityTarget(target: string | undefined) {
      return handlers.onObscurityTargetChange(target);
    },
    setViewport(viewport: string) {
      renderAdapter.setViewport?.(viewport);
    },
    async submitQuery(query: string) {
      return runSearch(() => handlers.onQuerySubmit(query));
    },
    async retryLastSearch() {
      return runSearch(() => renderAdapter.onRetrySearch?.());
    },
    cancelSearch() {
      renderAdapter.onCancelSearch?.();
    },
    async submitFeedback(feedbackType: string) {
      try {
        return await renderAdapter.onFeedback?.(feedbackType);
      } catch (error) {
        actionStatus = { type: "error", message: "Your feedback could not be sent." };
        scheduleStatusClear(errorStatusTimeoutMs);
        throw error;
      }
    },
    dismissFeedback() {
      renderAdapter.onFeedbackDismiss?.();
    },
    async saveBand(target: SavedBandTarget) {
      try {
        const result = await handlers.onSave(target);
        actionStatus = { type: "success", message: `Saved ${target.name}.` };
        scheduleStatusClear();
        return result;
      } catch (error) {
        actionStatus = { type: "error", message: `Save failed for ${target.name}.` };
        scheduleStatusClear();
        throw error;
      }
    },
    async rateBand(target: SavedBandTarget, rating: number | null) {
      try {
        const result = await handlers.onRate(target, rating);
        actionStatus =
          rating === null
            ? { type: "success", message: `Cleared the rating for ${target.name}.` }
            : { type: "success", message: `Rated ${target.name}: ${rating}/5.` };
        scheduleStatusClear();
        return result;
      } catch (error) {
        actionStatus = { type: "error", message: `Rating failed for ${target.name}.` };
        scheduleStatusClear();
        throw error;
      }
    },
    async unsaveBand(savedBandId: string, artistName: string) {
      try {
        const result = await handlers.onUnsave(savedBandId, artistName);
        actionStatus = { type: "success", message: `Removed ${artistName} from saved artists.` };
        scheduleStatusClear();
        return result;
      } catch (error) {
        actionStatus = { type: "error", message: `Could not remove ${artistName}.` };
        scheduleStatusClear();
        throw error;
      }
    },
    async saveCategoryNote(
      target: SavedBandTarget,
      updates: CategoryNoteUpdates,
    ) {
      try {
        const result = await handlers.onSaveCategoryNote(target, updates);
        actionStatus = { type: "success", message: `Updated ${target.name}.` };
        scheduleStatusClear();
        return result;
      } catch (error) {
        actionStatus = { type: "error", message: `Could not update ${target.name}.` };
        scheduleStatusClear();
        throw error;
      }
    },
    renderHtml() {
      const viewProps = renderAdapter.getViewProps();
      return renderToStaticMarkup(React.createElement(ChatAppView, { viewProps, handlers }));
    },
  };
  return shell;
}
