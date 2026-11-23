export const QUERY_MAX_LENGTH = 2000;
export const MESSAGE_CONTENT_MAX_LEN = 4000;
export const MESSAGES_MAX_COUNT = 50;
export const PRIORITY_CONTEXT_MAX_LEN = 2000;
export const CONVERSATION_ID_MAX_LEN = 100;

export type RecommendationMode = "fresh" | "preference-aware";

export type ObscurityTarget = "cult" | "underground" | "obscure";

const VALID_OBSCURITY_TARGETS: ReadonlySet<string> = new Set(["cult", "underground", "obscure"]);

export function validateObscurityTarget(value: unknown): ObscurityTarget | undefined {
  if (typeof value === "string" && VALID_OBSCURITY_TARGETS.has(value)) {
    return value as ObscurityTarget;
  }
  return undefined;
}

export type FeedbackType = "good" | "too_mainstream" | "wrong_direction";

const VALID_FEEDBACK_TYPES: ReadonlySet<string> = new Set(["good", "too_mainstream", "wrong_direction"]);

export function validateFeedbackType(value: unknown): FeedbackType | undefined {
  if (typeof value === "string" && VALID_FEEDBACK_TYPES.has(value)) {
    return value as FeedbackType;
  }
  return undefined;
}

/**
 * How long recommendation feedback is kept (GDPR Art. 5(1)(e)). The API
 * purges by it and the privacy policy states it, so both read it from here.
 */
export const FEEDBACK_RETENTION_DAYS = 90;

/**
 * Body of `POST /recommendations/:eventId/feedback` (#307): the verdict
 * plus the batch it judges, as the user asked for it. Nothing else records the
 * batch in production, so the feedback carries it.
 */
export type RecommendationFeedbackSubmission = {
  feedbackType: FeedbackType;
  query: string;
  mode: string;
  obscurityTarget: string | null;
  bandNames: string[];
};

/**
 * How a message was answered: by a new search, by picking from the bands the
 * conversation already found, or in words alone (no bands asked for).
 */
export type TurnKind = "search" | "pick" | "answer";

/** What the API is doing for a message, in the order it happens; a search may skip stages. */
export type AnswerProgress =
  /** Deciding how to answer, or planning the search. */
  | { stage: "thinking" }
  /** Searching the web; the reference artists the search starts from. */
  | { stage: "searching"; anchorArtists: string[] }
  /** Looking up the bands found. */
  | { stage: "checking"; found: number }
  /** Too few good bands: searching once more. */
  | { stage: "searchingAgain" }
  /** Choosing among the candidates and writing. */
  | { stage: "choosing"; candidates: number };

/**
 * `POST /recommendations` with `Accept: text/event-stream`: server-sent events
 * of these shapes, ending in `done` (the JSON response) or `error` (the JSON
 * error). `reply` carries the whole text so far; only `done` is final. A
 * request that fails or finishes before the first event gets plain JSON.
 */
export type AnswerEvent =
  | { type: "progress"; progress: AnswerProgress }
  | { type: "reply"; text: string }
  | { type: "done"; response: unknown }
  | { type: "error"; status: number; error: { code: string; message: string } };

/**
 * How long the API remembers the bands a conversation found, in memory only.
 * The privacy policy states it, so both read it from here.
 */
export const CONVERSATION_MEMORY_HOURS = 2;

export type ChatTurnRole = "user" | "assistant";

export type ChatMessage = { role: ChatTurnRole; content: string };

export type ValidateRecommendationItemResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export type ValidateSavedBandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

export type ValidatedRecommendationHttpBody =
  | { readonly ok: false; readonly error: string }
  | {
      readonly ok: true;
      readonly query: string;
      readonly mode: RecommendationMode;
      readonly messages: ChatMessage[];
      readonly selectedArtistIds: string[];
      readonly priorityContext: string;
      readonly truncated: string[];
      readonly obscurityTarget: ObscurityTarget | undefined;
      /** Which conversation the message continues; undefined for a one-off question. */
      readonly conversationId: string | undefined;
    };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateRecommendationItem(item: unknown): ValidateRecommendationItemResult {
  if (!item || typeof item !== "object") {
    return { ok: false, error: "artist is required" };
  }
  const rec = item as Record<string, unknown>;
  if (!isNonEmptyString(rec.artist)) {
    return { ok: false, error: "artist is required" };
  }
  if (!isNonEmptyString(rec.why)) {
    return { ok: false, error: "why is required" };
  }
  if (!isStringArray(rec.sourceSignals)) {
    return { ok: false, error: "sourceSignals must be a string array" };
  }
  if (rec.musicbrainzArtistId !== undefined && rec.musicbrainzArtistId !== null) {
    if (!isNonEmptyString(rec.musicbrainzArtistId)) {
      return { ok: false, error: "musicbrainzArtistId must be a non-empty string when present" };
    }
  }
  return { ok: true };
}

export function validateSavedBand(input: unknown): ValidateSavedBandResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "musicbrainzArtistId is required" };
  }
  const band = input as Record<string, unknown>;
  if (!isNonEmptyString(band.musicbrainzArtistId)) {
    return { ok: false, error: "musicbrainzArtistId is required" };
  }
  if (!isNonEmptyString(band.name)) {
    return { ok: false, error: "name is required" };
  }
  // Absent or null means "saved, not yet rated" — a real state, not a missing
  // field. Only a rating that is actually present has to be in range.
  if (band.rating !== undefined && band.rating !== null) {
    if (!Number.isInteger(band.rating) || (band.rating as number) < 1 || (band.rating as number) > 5) {
      return { ok: false, error: "rating must be an integer between 1 and 5" };
    }
  }
  if (!Array.isArray(band.categories)) {
    return { ok: false, error: "categories must be an array" };
  }
  if (typeof band.note !== "string") {
    return { ok: false, error: "note must be a string" };
  }
  return { ok: true };
}

export function validateRecommendationMode(mode: unknown): RecommendationMode {
  return mode === "preference-aware" ? "preference-aware" : "fresh";
}

/**
 * Validates POST /recommendations JSON body (query required; other fields optional).
 */
export function validateRecommendationHttpBody(body: unknown): ValidatedRecommendationHttpBody {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body is required" };
  }
  const b = body as Record<string, unknown>;
  const q = b.query;
  if (!isNonEmptyString(q)) {
    return { ok: false, error: "query is required" };
  }
  if (q.trim().length > QUERY_MAX_LENGTH) {
    return { ok: false, error: "query too long" };
  }

  const mode = validateRecommendationMode(b.mode);

  const messages: ChatMessage[] = [];
  if (b.messages !== undefined) {
    const raw = b.messages;
    if (!Array.isArray(raw)) {
      return { ok: false, error: "messages must be an array" };
    }
    if (raw.length > MESSAGES_MAX_COUNT) {
      return { ok: false, error: "too many messages" };
    }
    for (const m of raw) {
      if (!m || typeof m !== "object") {
        return { ok: false, error: "each message must be an object" };
      }
      const msg = m as Record<string, unknown>;
      const role = msg.role;
      const content = msg.content;
      if (role !== "user" && role !== "assistant") {
        return { ok: false, error: "message role must be user or assistant" };
      }
      if (typeof content !== "string") {
        return { ok: false, error: "message content must be a string" };
      }
      if (content.length > MESSAGE_CONTENT_MAX_LEN) {
        return { ok: false, error: "message content too long" };
      }
      messages.push({ role, content });
    }
  }

  let selectedArtistIds: string[] = [];
  if (b.selectedArtistIds !== undefined) {
    const raw = b.selectedArtistIds;
    if (!Array.isArray(raw)) {
      return { ok: false, error: "selectedArtistIds must be an array" };
    }
    if (!raw.every((id) => typeof id === "string")) {
      return { ok: false, error: "selectedArtistIds must contain only strings" };
    }
    selectedArtistIds = raw as string[];
  }

  const rawPriority = typeof b.priorityContext === "string" ? b.priorityContext.trim() : "";
  const truncated: string[] = [];
  let priorityContext = rawPriority;
  if (rawPriority.length > PRIORITY_CONTEXT_MAX_LEN) {
    priorityContext = rawPriority.slice(0, PRIORITY_CONTEXT_MAX_LEN);
    truncated.push("priorityContext");
  }

  return {
    ok: true,
    query: q.trim(),
    mode,
    messages,
    selectedArtistIds,
    priorityContext,
    truncated,
    obscurityTarget: validateObscurityTarget(b.obscurityTarget),
    conversationId: validateConversationId(b.conversationId),
  };
}

function validateConversationId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : "";
  return id && id.length <= CONVERSATION_ID_MAX_LEN ? id : undefined;
}

/**
 * How a saved band's rating is stated to the model.
 *
 * Shared because two call sites format saved bands for a prompt — the API's
 * preference context and the desktop's priority-style-reference line — and they
 * drifted: one said "not yet rated" while the other interpolated the absence
 * straight in as "rating null/5". A missing judgement must never be reported as
 * a number: 0 reads as a strong dislike the user never expressed.
 */
export function formatRatingForPrompt(rating: number | null | undefined): string {
  return rating == null ? "not yet rated" : `rating ${rating}/5`;
}
