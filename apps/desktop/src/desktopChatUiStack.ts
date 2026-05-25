import { createChatViewModel } from "./chatViewModel.js";
import { createChatScreenModel } from "./chatScreenModel.js";
import { createChatScreen } from "./chatScreen.js";

function normalizeViewport(v: string): string {
  return v === "mobile" ? "mobile" : "desktop";
}

/**
 * Single composition root for the desktop chat UI stack (view model → screen model → screen).
 */
export function createDesktopChatUiStack({ app, viewport = "desktop" }: { app: any; viewport?: string }) {
  let viewportState = normalizeViewport(viewport);
  const viewModel = createChatViewModel({ app });
  const screenModel = createChatScreenModel({ viewModel });
  const screen = createChatScreen({ viewModel, screenModel });

  return {
    setViewport(next: string) {
      viewportState = normalizeViewport(next);
    },
    getViewport() {
      return viewportState;
    },
    getRenderState() {
      return screen.getRenderState({ viewport: viewportState });
    },
    handleModeChange(mode: string) {
      screen.handleModeChange(mode);
      return screen.getRenderState({ viewport: viewportState });
    },
    async handleQuerySubmit(query: string) {
      await screen.handleQuerySubmit(query);
      return screen.getRenderState({ viewport: viewportState });
    },
  };
}
