import { createChatAppModel, type ConversationMessage } from "./chatAppModel.js";

export type DesktopChatUiStack = {
  setViewport(next: string): void;
  getViewport(): string;
  setMode(mode: string): void;
  getMode(): string;
  isLoading(): boolean;
  getConversation(): ConversationMessage[] | null;
  submitQuery(query: string): Promise<unknown>;
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
    isLoading() {
      return appModel.isLoading();
    },
    getConversation() {
      return appModel.getConversation();
    },
    async submitQuery(query: string) {
      return appModel.submitQuery(query);
    },
  };
}
