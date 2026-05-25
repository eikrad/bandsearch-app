const MODE_OPTIONS = [
  { value: "fresh", label: "Fresh search" },
  { value: "preference-aware", label: "Preference-aware" },
];

export function createChatScreen({ viewModel, screenModel }: { viewModel: any; screenModel: any }) {
  return {
    getRenderState({ viewport = "desktop" }: { viewport?: string } = {}) {
      const state = screenModel.getScreenState({ viewport });
      return {
        ...state,
        viewport,
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
    handleModeChange(mode: string) {
      viewModel.setMode(mode);
    },
    async handleQuerySubmit(query: string) {
      return viewModel.submitQuery(query);
    },
  };
}
