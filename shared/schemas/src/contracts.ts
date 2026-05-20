export const QUERY_MAX_LENGTH = 2000;
export const MESSAGE_CONTENT_MAX_LEN = 4000;
export const MESSAGES_MAX_COUNT = 50;
export const PRIORITY_CONTEXT_MAX_LEN = 2000;

export type RecommendationMode = "fresh" | "preference-aware";

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
  if (!Number.isInteger(band.rating) || (band.rating as number) < 1 || (band.rating as number) > 5) {
    return { ok: false, error: "rating must be an integer between 1 and 5" };
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
  const priorityContext = rawPriority.length > PRIORITY_CONTEXT_MAX_LEN
    ? rawPriority.slice(0, PRIORITY_CONTEXT_MAX_LEN)
    : rawPriority;

  return {
    ok: true,
    query: q.trim(),
    mode,
    messages,
    selectedArtistIds,
    priorityContext,
  };
}
