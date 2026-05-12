const { createChatViewModel } = require("./chatViewModel");
const { createChatScreenModel } = require("./chatScreenModel");
const { createChatScreen } = require("./chatScreen");

function normalizeViewport(v) {
  return v === "mobile" ? "mobile" : "desktop";
}

/**
 * Single composition root for the desktop chat UI stack (view model → screen model → screen).
 *
 * @param {{ app: any, viewport?: string }} options
 */
function createDesktopChatUiStack({ app, viewport = "desktop" }) {
  let viewportState = normalizeViewport(viewport);
  const viewModel = createChatViewModel({ app });
  const screenModel = createChatScreenModel({ viewModel });
  const screen = createChatScreen({ viewModel, screenModel });

  return {
    setViewport(next) {
      viewportState = normalizeViewport(next);
    },
    getViewport() {
      return viewportState;
    },
    getRenderState() {
      return screen.getRenderState({ viewport: viewportState });
    },
    handleModeChange(mode) {
      screen.handleModeChange(mode);
      return screen.getRenderState({ viewport: viewportState });
    },
    async handleQuerySubmit(query) {
      await screen.handleQuerySubmit(query);
      return screen.getRenderState({ viewport: viewportState });
    },
  };
}

module.exports = {
  createDesktopChatUiStack,
};
