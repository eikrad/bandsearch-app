import type { CardViewProps, ChatViewProps } from "../../src/chatRenderAdapter.js";
import type { ChatHandlers } from "../../src/ui/viewTypes.js";
import type { SavedArtistsViewProps } from "../../src/ui/viewTypes.js";

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

// Same idea for a single recommendation card: the adapter builds every field,
// so a test that only cares about the title must still supply the rest.
const BASE_CARD: CardViewProps = {
  title: "Fen",
  why: "",
  country: "",
  genres: [],
  signals: [],
  connection: "",
  imageUrl: null,
  saved: false,
  rating: null,
  savedBandId: null,
  categories: [],
  note: "",
  noteEdited: false,
  actions: {
    save: { visible: true },
    rate: { visible: true },
    more: { visible: true },
  },
  platformLinks: [],
};

export function cardViewProps(overrides: Partial<CardViewProps> = {}): CardViewProps {
  return { ...BASE_CARD, ...overrides };
}

// The saved-artists screen state is likewise fully populated by the model.
const BASE_SAVED_ARTISTS: SavedArtistsViewProps = {
  header: { title: "Saved Artists", subtitle: "Your style references" },
  isLoading: false,
  artists: [],
  selectedCount: 0,
  searchResults: [],
  isSearching: false,
  groups: [],
};

export function savedArtistsViewProps(
  overrides: Partial<SavedArtistsViewProps> = {},
): SavedArtistsViewProps {
  return { ...BASE_SAVED_ARTISTS, ...overrides };
}

const BASE_HANDLERS: ChatHandlers = {
  onModeChange: () => {},
  onQuerySubmit: () => {},
  onSave: () => {},
  onRate: () => {},
};

export function chatHandlers(overrides: Partial<ChatHandlers> = {}): ChatHandlers {
  return { ...BASE_HANDLERS, ...overrides };
}
