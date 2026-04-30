const { createChatClient, createInitialChatState, applyAssistantMessage } = require("./chatClient");
const { createChatViewModel } = require("./chatViewModel");
const { createChatScreenModel } = require("./chatScreenModel");
const { createChatScreen } = require("./chatScreen");

/**
 * @param {{ apiBaseUrl?: string, fetchImpl?: any }} [options]
 */
function bootstrapDesktopApp({ apiBaseUrl = "http://localhost:3001", fetchImpl } = {}) {
  const chatClient = createChatClient({ apiBaseUrl, fetchImpl });
  let state = createInitialChatState();

  return {
    getState() {
      return state;
    },
    async requestRecommendations(query, mode = "fresh") {
      const result = await chatClient.fetchRecommendations(query, mode);
      state = applyAssistantMessage(state, result);
      return result;
    },
  };
}

function bootstrapDesktopUi({ app, viewport = "desktop" }) {
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

module.exports = { bootstrapDesktopApp, bootstrapDesktopUi };
