import { buildPlatformLinks } from "./platformLinks.js";
import type { ConversationMessage, RenderableRecommendation } from "./chatAppModel.js";
import type { DesktopChatUiStack } from "./desktopChatUiStack.js";

const MODE_OPTIONS = [
  { value: "fresh", label: "Fresh search" },
  { value: "preference-aware", label: "Preference-aware" },
];

function buildCardViewProps(card: RenderableRecommendation) {
  return {
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

function buildViewProps(desktopUi: DesktopChatUiStack) {
  const viewport = desktopUi.getViewport();
  const conversation = desktopUi.getConversation();
  const loading = desktopUi.isLoading();

  const messageViewProps = conversation ? buildMessageViewProps(conversation) : null;
  const cards = getLatestCards(conversation);

  return {
    headerTitle: "Bandsearch",
    headerSubtitle: "Niche music recommendations",
    viewport,
    modeValue: desktopUi.getMode(),
    modeOptions: MODE_OPTIONS,
    isLoading: loading,
    queryPlaceholder: "Describe bands you like...",
    queryDisabled: loading,
    obscurityTarget: desktopUi.getObscurityTarget(),
    showFeedbackBar: desktopUi.isShowFeedbackBar(),
    cards,
    messages: messageViewProps && messageViewProps.length > 0 ? messageViewProps : undefined,
  };
}

export function createChatRenderAdapter({ desktopUi }: { desktopUi: DesktopChatUiStack }) {
  return {
    getViewProps() {
      return buildViewProps(desktopUi);
    },
    onModeChange(mode: string) {
      desktopUi.setMode(mode);
      return buildViewProps(desktopUi);
    },
    onObscurityTargetChange(target: string | undefined) {
      desktopUi.setObscurityTarget(target);
      return buildViewProps(desktopUi);
    },
    async onSubmitQuery(query: string) {
      await desktopUi.submitQuery(query);
      return buildViewProps(desktopUi);
    },
    async onFeedback(feedbackType: string) {
      await desktopUi.submitFeedback(feedbackType);
      return buildViewProps(desktopUi);
    },
    onFeedbackDismiss() {
      desktopUi.dismissFeedbackBar();
      return buildViewProps(desktopUi);
    },
  };
}
