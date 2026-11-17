import { buildPlatformLinks } from "./platformLinks.js";
import type { ChatAppModel, ConversationMessage, RenderableRecommendation } from "./chatAppModel.js";

/** The chat state and commands the chat screen renders and sends. */
export type ChatScreenModel = Pick<
  ChatAppModel,
  | "getMode"
  | "setMode"
  | "getObscurityTarget"
  | "setObscurityTarget"
  | "isLoading"
  | "isShowFeedbackBar"
  | "dismissFeedbackBar"
  | "getConversation"
  | "submitQuery"
  | "retryLastSearch"
  | "cancelSearch"
  | "submitFeedback"
>;

const MODE_OPTIONS = [
  { value: "fresh", label: "Fresh search" },
  { value: "preference-aware", label: "Preference-aware" },
];

function buildCardViewProps(card: RenderableRecommendation) {
  return {
    target: card.target,
    title: card.title,
    why: card.why,
    country: card.country,
    genres: card.genres,
    signals: card.signals,
    connection: card.connection,
    imageUrl: card.imageUrl,
    saved: card.saved,
    rating: card.rating,
    savedBandId: card.savedBandId,
    categories: card.categories,
    note: card.note,
    noteEdited: card.noteEdited,
    // Rating stars, Save/Saved, and the ··· overflow are primary controls
    // that never collapse on any viewport (UI_GUIDELINES.md, "Action row
    // policy" — #152 was this gated behind `!isMobile`).
    actions: {
      save: { visible: true },
      rate: { visible: true },
      more: { visible: true },
    },
    platformLinks: buildPlatformLinks(card.title),
  };
}

function buildMessageViewProps(messages: ConversationMessage[]) {
  return messages.map((msg) => {
    if (msg.role === "user") {
      return { id: msg.id, role: "user" as const, content: msg.content };
    }
    return {
      id: msg.id,
      role: "assistant" as const,
      content: msg.content,
      cards: msg.cards.map((card) => buildCardViewProps(card)),
    };
  });
}

function getLatestCards(conversation: ConversationMessage[] | null) {
  if (!conversation) return [];
  for (let i = conversation.length - 1; i >= 0; i--) {
    const msg = conversation[i];
    if (msg.role === "assistant" && msg.cards.length > 0) {
      return msg.cards.map((card) => buildCardViewProps(card));
    }
  }
  return [];
}

/** A card as the view renders it — derived so the view cannot drift from the adapter. */
export type CardViewProps = ReturnType<typeof buildCardViewProps>;
export type MessageViewProps = ReturnType<typeof buildMessageViewProps>[number];
export type ChatViewProps = ReturnType<typeof buildViewProps> & {
  actionStatus?: { type: "success" | "error"; message: string } | null;
};

function normalizeViewport(viewport: string): "mobile" | "desktop" {
  return viewport === "mobile" ? "mobile" : "desktop";
}

function buildViewProps(chat: ChatScreenModel, viewport: "mobile" | "desktop") {
  const conversation = chat.getConversation();
  const loading = chat.isLoading();

  const messageViewProps = conversation ? buildMessageViewProps(conversation) : null;
  const cards = getLatestCards(conversation);

  return {
    headerTitle: "Bandsearch",
    headerSubtitle: "Niche music recommendations",
    viewport,
    modeValue: chat.getMode(),
    modeOptions: MODE_OPTIONS,
    isLoading: loading,
    queryPlaceholder: "Describe bands you like...",
    queryDisabled: loading,
    obscurityTarget: chat.getObscurityTarget(),
    showFeedbackBar: chat.isShowFeedbackBar(),
    cards,
    messages: messageViewProps && messageViewProps.length > 0 ? messageViewProps : undefined,
  };
}

export function createChatRenderAdapter({
  chat,
  viewport = "desktop",
}: {
  chat: ChatScreenModel;
  viewport?: string;
}) {
  let currentViewport = normalizeViewport(viewport);
  const viewProps = () => buildViewProps(chat, currentViewport);
  return {
    getViewProps: viewProps,
    setViewport(next: string) {
      currentViewport = normalizeViewport(next);
    },
    onModeChange(mode: string) {
      chat.setMode(mode);
      return viewProps();
    },
    onObscurityTargetChange(target: string | undefined) {
      chat.setObscurityTarget(target);
      return viewProps();
    },
    async onSubmitQuery(query: string) {
      await chat.submitQuery(query);
      return viewProps();
    },
    async onRetrySearch() {
      await chat.retryLastSearch();
      return viewProps();
    },
    onCancelSearch() {
      chat.cancelSearch();
      return viewProps();
    },
    async onFeedback(feedbackType: string) {
      await chat.submitFeedback(feedbackType);
      return viewProps();
    },
    onFeedbackDismiss() {
      chat.dismissFeedbackBar();
      return viewProps();
    },
  };
}
