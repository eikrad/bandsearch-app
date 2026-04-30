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

module.exports = {
  validateRecommendationItem,
  validateSavedBand,
  validateRecommendationMode,
};
