const { createChatClient, createInitialChatState, applyAssistantMessage } = require("./chatClient");

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

module.exports = { bootstrapDesktopApp };
