const { createChatClient, createInitialChatState, applyAssistantMessage } = require("./chatClient");
const { createChatViewModel } = require("./chatViewModel");
const { createChatScreenModel } = require("./chatScreenModel");
const { createChatScreen } = require("./chatScreen");
const { createChatRenderAdapter } = require("./chatRenderAdapter");
const { createDesktopReactShell } = require("./ui/createDesktopReactShell");
const { createDesktopReactMount } = require("./ui/mountDesktopReactApp");

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

function bootstrapDesktopRenderAdapter({ app, viewport = "desktop" }) {
  const desktopUi = bootstrapDesktopUi({ app, viewport });
  return createChatRenderAdapter({ desktopUi });
}

function bootstrapDesktopReactShell({ app, viewport = "desktop", actionHandlers = {} }) {
  const renderAdapter = bootstrapDesktopRenderAdapter({ app, viewport });
  return createDesktopReactShell({ renderAdapter, actionHandlers });
}

function bootstrapDesktopReactApp({ app, viewport = "desktop", actionHandlers = {} }) {
  const shell = bootstrapDesktopReactShell({ app, viewport, actionHandlers });
  return createDesktopReactMount({ shell });
}

module.exports = {
  bootstrapDesktopApp,
  bootstrapDesktopUi,
  bootstrapDesktopRenderAdapter,
  bootstrapDesktopReactShell,
  bootstrapDesktopReactApp,
};
