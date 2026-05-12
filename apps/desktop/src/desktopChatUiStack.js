const { createChatViewModel } = require("./chatViewModel");
const { createChatScreenModel } = require("./chatScreenModel");
const { createChatScreen } = require("./chatScreen");

/**
 * Single composition root for the desktop chat UI stack (view model → screen model → screen).
 *
 * @param {{ app: any, viewport?: string }} options
 */
function createDesktopChatUiStack({ app, viewport = "desktop" }) {
  const viewModel = createChatViewModel({ app });
  const screenModel = createChatScreenModel({ viewModel });
  const screen = createChatScreen({ viewModel, screenModel });

  return {
    getRenderState() {
      return screen.getRenderState({ viewport });
    },
    handleModeChange(mode) {
      screen.handleModeChange(mode);
      return screen.getRenderState({ viewport });
    },
    async handleQuerySubmit(query) {
      await screen.handleQuerySubmit(query);
      return screen.getRenderState({ viewport });
    },
  };
}

module.exports = {
  createDesktopChatUiStack,
};
