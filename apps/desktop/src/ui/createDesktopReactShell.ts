import type { SavedBandTarget, CategoryNoteUpdates } from "../savedBandActions.js";
import type { ChatViewProps } from "../chatRenderAdapter.js";
import type { ChatHandlers } from "./viewTypes.js";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatAppView } from "./ChatAppView.js";
import { formatRecommendationQueryError } from "../apiErrorMessages.js";
import { createStatusMessage, type StatusMessage, type TimerHandle } from "../statusMessage.js";

type ActionStatus = StatusMessage | null;

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
    subscribe?: (listener: () => void) => () => void;
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
  const status = createStatusMessage({
    confirmationMs: statusTimeoutMs,
    errorMs: errorStatusTimeoutMs,
    setTimeoutImpl,
  });

  /**
   * Search and Retry fail the same way: an inline error the user can act on.
   * A stopped search is not a failure — the model settles it without an error.
   */
  async function runSearch(start: () => unknown) {
    try {
      return await start();
    } catch (error) {
      status.show({ type: "error", message: formatRecommendationQueryError(error) });
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
      const unsubscribes = [status.subscribe(listener), renderAdapter.subscribe?.(listener)];
      return () => { for (const unsubscribe of unsubscribes) unsubscribe?.(); };
    },
    getViewProps(): ChatViewProps & { actionStatus?: ActionStatus } {
      const base = renderAdapter.getViewProps();
      return { ...base, actionStatus: status.get() };
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
        status.show({ type: "error", message: "Your feedback could not be sent." });
        throw error;
      }
    },
    dismissFeedback() {
      renderAdapter.onFeedbackDismiss?.();
    },
    async saveBand(target: SavedBandTarget) {
      try {
        const result = await handlers.onSave(target);
        status.show({ type: "success", message: `Saved ${target.name}.` });
        return result;
      } catch (error) {
        status.show({ type: "error", message: `Save failed for ${target.name}.` });
        throw error;
      }
    },
    async rateBand(target: SavedBandTarget, rating: number | null) {
      try {
        const result = await handlers.onRate(target, rating);
        status.show({
          type: "success",
          message: rating === null ? `Cleared the rating for ${target.name}.` : `Rated ${target.name}: ${rating}/5.`,
        });
        return result;
      } catch (error) {
        status.show({ type: "error", message: `Rating failed for ${target.name}.` });
        throw error;
      }
    },
    async unsaveBand(savedBandId: string, artistName: string) {
      try {
        const result = await handlers.onUnsave(savedBandId, artistName);
        status.show({ type: "success", message: `Removed ${artistName} from saved artists.` });
        return result;
      } catch (error) {
        status.show({ type: "error", message: `Could not remove ${artistName}.` });
        throw error;
      }
    },
    async saveCategoryNote(
      target: SavedBandTarget,
      updates: CategoryNoteUpdates,
    ) {
      try {
        const result = await handlers.onSaveCategoryNote(target, updates);
        status.show({ type: "success", message: `Updated ${target.name}.` });
        return result;
      } catch (error) {
        status.show({ type: "error", message: `Could not update ${target.name}.` });
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
