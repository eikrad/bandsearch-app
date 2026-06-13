import { createChatAppModel, type ConversationMessage } from "./chatAppModel.js";

export type DesktopChatUiStack = {
  setViewport(next: string): void;
  getViewport(): string;
  setMode(mode: string): void;
  getMode(): string;
  setObscurityTarget(target: string | undefined): void;
  getObscurityTarget(): string | undefined;
  isLoading(): boolean;
  isShowFeedbackBar(): boolean;
  dismissFeedbackBar(): void;
  getConversation(): ConversationMessage[] | null;
  submitQuery(query: string): Promise<unknown>;
  submitFeedback(feedbackType: string): Promise<void>;
  cancelSearch(): void;
  retryLastSearch(): Promise<unknown>;
};

function normalizeViewport(v: string): string {
  return v === "mobile" ? "mobile" : "desktop";
}

export function createDesktopChatUiStack({
  app,
  viewport = "desktop",
}: {
  app: any;
  viewport?: string;
}): DesktopChatUiStack {
  let viewportState = normalizeViewport(viewport);
  const appModel = createChatAppModel({ app });

  return {
    setViewport(next: string) {
      viewportState = normalizeViewport(next);
    },
    getViewport() {
      return viewportState;
    },
    setMode(mode: string) {
      appModel.setMode(mode);
    },
    getMode() {
      return appModel.getMode();
    },
    setObscurityTarget(target: string | undefined) {
      appModel.setObscurityTarget(target);
    },
    getObscurityTarget(): string | undefined {
      return appModel.getObscurityTarget();
    },
    isLoading() {
      return appModel.isLoading();
    },
    isShowFeedbackBar() {
      return appModel.isShowFeedbackBar();
    },
    dismissFeedbackBar() {
      appModel.dismissFeedbackBar();
    },
    getConversation() {
      return appModel.getConversation();
    },
    async submitQuery(query: string) {
      return appModel.submitQuery(query);
    },
    async submitFeedback(feedbackType: string) {
      return appModel.submitFeedback(feedbackType);
    },
    cancelSearch() {
      (app as any).cancelSearch?.();
    },
    async retryLastSearch() {
      return appModel.retryLastSearch();
    },
  };
}
