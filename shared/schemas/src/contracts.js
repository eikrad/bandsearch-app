function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateRecommendationItem(item) {
  if (!item || !isNonEmptyString(item.artist)) {
    return { ok: false, error: "artist is required" };
  }
  if (!isNonEmptyString(item.why)) {
    return { ok: false, error: "why is required" };
  }
  if (!isStringArray(item.sourceSignals)) {
    return { ok: false, error: "sourceSignals must be a string array" };
  }
  if (item.musicbrainzArtistId !== undefined && item.musicbrainzArtistId !== null) {
    if (!isNonEmptyString(item.musicbrainzArtistId)) {
      return { ok: false, error: "musicbrainzArtistId must be a non-empty string when present" };
    }
  }
  return { ok: true };
}

function validateSavedBand(input) {
  if (!input || !isNonEmptyString(input.musicbrainzArtistId)) {
    return { ok: false, error: "musicbrainzArtistId is required" };
  }
  if (!isNonEmptyString(input.name)) {
    return { ok: false, error: "name is required" };
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "rating must be an integer between 1 and 5" };
  }
  if (!Array.isArray(input.categories)) {
    return { ok: false, error: "categories must be an array" };
  }
  if (typeof input.note !== "string") {
    return { ok: false, error: "note must be a string" };
  }
  return { ok: true };
}

function validateRecommendationMode(mode) {
  return mode === "preference-aware" ? "preference-aware" : "fresh";
}

/**
 * Validates POST /recommendations JSON body (query required; other fields optional).
 *
 * @param {unknown} body
 */
function validateRecommendationHttpBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body is required" };
  }
  const q = /** @type {any} */ (body).query;
  if (!isNonEmptyString(q)) {
    return { ok: false, error: "query is required" };
  }

  const mode = validateRecommendationMode(/** @type {any} */ (body).mode);

  let messages = [];
  if (/** @type {any} */ (body).messages !== undefined) {
    const raw = /** @type {any} */ (body).messages;
    if (!Array.isArray(raw)) {
      return { ok: false, error: "messages must be an array" };
    }
    for (const m of raw) {
      if (!m || typeof m !== "object") {
        return { ok: false, error: "each message must be an object" };
      }
      const role = /** @type {any} */ (m).role;
      const content = /** @type {any} */ (m).content;
      if (role !== "user" && role !== "assistant") {
        return { ok: false, error: "message role must be user or assistant" };
      }
      if (typeof content !== "string") {
        return { ok: false, error: "message content must be a string" };
      }
      messages.push({ role, content });
    }
  }

  let selectedArtistIds = [];
  if (/** @type {any} */ (body).selectedArtistIds !== undefined) {
    const raw = /** @type {any} */ (body).selectedArtistIds;
    if (!Array.isArray(raw)) {
      return { ok: false, error: "selectedArtistIds must be an array" };
    }
    if (!raw.every((id) => typeof id === "string")) {
      return { ok: false, error: "selectedArtistIds must contain only strings" };
    }
    selectedArtistIds = raw;
  }

  const priorityContext =
    typeof /** @type {any} */ (body).priorityContext === "string"
      ? /** @type {any} */ (body).priorityContext.trim()
      : "";

  return {
    ok: true,
    query: q.trim(),
    mode,
    messages,
    selectedArtistIds,
    priorityContext,
  };
}

module.exports = {
  validateRecommendationItem,
  validateSavedBand,
  validateRecommendationMode,
  validateRecommendationHttpBody,
};
