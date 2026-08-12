import type { ChatViewProps } from "../../src/chatRenderAdapter.js";

// A complete ChatViewProps so each test only states the fields it asserts on.
// Without this the shell's getViewProps seam would have to be typed loosely,
// which is what let the views drift from the adapter in the first place.
const BASE: ChatViewProps = {
  headerTitle: "Bandsearch",
  headerSubtitle: "Niche music recommendations",
  viewport: "desktop",
  modeValue: "fresh",
  modeOptions: [],
  isLoading: false,
  queryPlaceholder: "Describe bands you like...",
  queryDisabled: false,
  obscurityTarget: undefined,
  showFeedbackBar: false,
  cards: [],
  messages: undefined,
};

export function chatViewProps(overrides: Partial<ChatViewProps> = {}): ChatViewProps {
  return { ...BASE, ...overrides };
}
