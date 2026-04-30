const MODE_OPTIONS = [
  { value: "fresh", label: "Fresh search" },
  { value: "preference-aware", label: "Preference-aware" },
];

function createChatScreen({ viewModel, screenModel }) {
  return {
    getRenderState({ viewport = "desktop" } = {}) {
      const state = screenModel.getScreenState({ viewport });
      return {
        ...state,
        modeSelector: {
          value: state.mode,
          options: MODE_OPTIONS,
        },
        queryInput: {
          placeholder: "Describe bands you like...",
          disabled: state.isLoading,
        },
        recommendationList: {
          items: state.recommendationCards,
          emptyText: "No recommendations yet. Start with a band or genre.",
        },
      };
    },
    handleModeChange(mode) {
      viewModel.setMode(mode);
    },
    async handleQuerySubmit(query) {
      return viewModel.submitQuery(query);
    },
  };
}

module.exports = {
  createChatScreen,
};
