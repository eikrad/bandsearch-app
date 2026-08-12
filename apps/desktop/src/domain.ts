// Shapes exchanged with the API, shared by the client, the app, the view
// models and the React views.
//
// These are deliberately permissive about optional fields: the API is the
// source of truth and older rows may lack newer columns, so the views already
// guard with defaults. What they buy is a name for each payload, so a change on
// one side stops compiling on the other instead of drifting silently.

/** A recommendation as the API sends it, before it is turned into a card. */
export type RecommendationItem = {
  artist: string;
  why?: string;
  country?: string;
  genres?: string[];
  sourceSignals?: string[];
  connection?: string;
  imageUrl?: string | null;
  musicbrainzArtistId?: string;
};

export type RecommendationMeta = {
  modeUsed?: string;
  usedPreferenceContext?: boolean;
  eventId?: string;
};

export type RecommendationResponse = {
  recommendations?: RecommendationItem[];
  assistantReply?: string;
  meta?: RecommendationMeta;
};

/** A saved preference row. */
export type SavedBand = {
  id: string;
  name: string;
  rating?: number | null;
  note?: string;
  categories?: string[];
  musicbrainzArtistId?: string;
};

/** A MusicBrainz hit from artist search. */
export type ArtistSearchResult = {
  id: string;
  name: string;
  score?: number;
  disambiguation?: string;
};

/** A band grouping, either user-made or inferred. */
export type ArtistGroup = {
  id: string;
  name: string;
  memberIds: string[];
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt?: string;
};

/** A message as it sits in the app's chat state. */
export type ChatStateMessage = {
  role: string;
  content?: string;
  recommendations?: RecommendationItem[];
  meta?: RecommendationMeta;
};
