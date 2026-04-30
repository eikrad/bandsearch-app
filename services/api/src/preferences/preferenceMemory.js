const { randomUUID } = require("node:crypto");

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateSavedBandInput(input) {
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

function createPreferenceMemory() {
  const savedBands = [];

  return {
    addSavedBand(input) {
      const validation = validateSavedBandInput(input);
      if (!validation.ok) {
        return validation;
      }

      const now = new Date().toISOString();
      const savedBand = {
        id: randomUUID(),
        musicbrainzArtistId: input.musicbrainzArtistId.trim(),
        name: input.name.trim(),
        rating: input.rating,
        categories: input.categories.map((c) => String(c).trim()).filter(Boolean),
        note: input.note.trim(),
        createdAt: now,
        updatedAt: now,
      };

      savedBands.push(savedBand);
      return { ok: true, savedBand };
    },

    listSavedBands() {
      return [...savedBands];
    },

    updateSavedBand(id, updates) {
      const index = savedBands.findIndex((band) => band.id === id);
      if (index === -1) {
        return { ok: false, status: 404, error: "saved band not found" };
      }

      const current = savedBands[index];
      const next = {
        ...current,
        rating: updates.rating !== undefined ? updates.rating : current.rating,
        categories: updates.categories !== undefined ? updates.categories : current.categories,
        note: updates.note !== undefined ? updates.note : current.note,
      };

      const validation = validateSavedBandInput({
        musicbrainzArtistId: current.musicbrainzArtistId,
        name: current.name,
        rating: next.rating,
        categories: next.categories,
        note: next.note,
      });

      if (!validation.ok) {
        return { ok: false, status: 400, error: validation.error };
      }

      savedBands[index] = {
        ...current,
        rating: next.rating,
        categories: next.categories.map((c) => String(c).trim()).filter(Boolean),
        note: String(next.note).trim(),
        updatedAt: new Date().toISOString(),
      };

      return { ok: true, savedBand: savedBands[index] };
    },

    deleteSavedBand(id) {
      const index = savedBands.findIndex((band) => band.id === id);
      if (index === -1) {
        return { ok: false, status: 404, error: "saved band not found" };
      }

      const [deleted] = savedBands.splice(index, 1);
      return { ok: true, deletedId: deleted.id };
    },

    buildContext() {
      if (savedBands.length === 0) {
        return "";
      }

      return savedBands
        .map(
          (band) =>
            `${band.name} (rating ${band.rating}/5) tags: ${band.categories.join(", ")} note: ${band.note}`,
        )
        .join("\n");
    },
  };
}

module.exports = {
  createPreferenceMemory,
  validateSavedBandInput,
};
