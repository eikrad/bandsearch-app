const { randomUUID } = require("node:crypto");
const { validateSavedBand: validateSavedBandInput } = require("../../../../shared/schemas/src/contracts");
const { formatSavedBandContextLine } = require("./savedBandContextFormat");

function mapRowToSavedBand(row) {
  return {
    id: row.id,
    musicbrainzArtistId: row.musicbrainz_artist_id,
    name: row.name,
    rating: Number(row.rating),
    categories: JSON.parse(row.categories || "[]"),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createTursoPreferenceRepository({ client }) {
  return {
    async addSavedBand(input) {
      const validation = validateSavedBandInput(input);
      if (!validation.ok) return validation;

      const id = randomUUID();
      const now = new Date().toISOString();
      const categories = JSON.stringify(input.categories.map((c) => String(c).trim()).filter(Boolean));
      const note = input.note.trim();
      const name = input.name.trim();
      const musicbrainzArtistId = input.musicbrainzArtistId.trim();

      const result = await client.execute({
        sql: `INSERT INTO saved_bands
                (id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              RETURNING *`,
        args: [id, musicbrainzArtistId, name, input.rating, categories, note, now, now],
      });

      return { ok: true, savedBand: mapRowToSavedBand(result.rows[0]) };
    },

    async listSavedBands() {
      const result = await client.execute({
        sql: "SELECT * FROM saved_bands ORDER BY updated_at DESC",
        args: [],
      });
      return result.rows.map(mapRowToSavedBand);
    },

    async updateSavedBand(id, updates) {
      const selectResult = await client.execute({
        sql: "SELECT * FROM saved_bands WHERE id = ?",
        args: [id],
      });
      if (selectResult.rows.length === 0) return { ok: false, status: 404, error: "saved band not found" };

      const current = mapRowToSavedBand(selectResult.rows[0]);
      const next = {
        rating: updates.rating !== undefined ? updates.rating : current.rating,
        categories: updates.categories !== undefined ? updates.categories : current.categories,
        note: updates.note !== undefined ? updates.note : current.note,
      };

      const validation = validateSavedBandInput({
        musicbrainzArtistId: current.musicbrainzArtistId,
        name: current.name,
        ...next,
      });
      if (!validation.ok) return { ok: false, status: 400, error: validation.error };

      const normalizedCategories = JSON.stringify(next.categories.map((c) => String(c).trim()).filter(Boolean));
      const normalizedNote = String(next.note).trim();
      const updatedAt = new Date().toISOString();

      const updateResult = await client.execute({
        sql: `UPDATE saved_bands
              SET rating = ?, categories = ?, note = ?, updated_at = ?
              WHERE id = ?
              RETURNING *`,
        args: [next.rating, normalizedCategories, normalizedNote, updatedAt, id],
      });

      return { ok: true, savedBand: mapRowToSavedBand(updateResult.rows[0]) };
    },

    async deleteSavedBand(id) {
      const result = await client.execute({
        sql: "DELETE FROM saved_bands WHERE id = ?",
        args: [id],
      });
      if (result.rowsAffected === 0) return { ok: false, status: 404, error: "saved band not found" };
      return { ok: true, deletedId: id };
    },

    async buildContext() {
      const savedBands = await this.listSavedBands();
      if (savedBands.length === 0) return "";
      return savedBands.map(formatSavedBandContextLine).join("\n");
    },

    async buildContextForIds(ids) {
      if (!ids || ids.length === 0) return "";
      const savedBands = await this.listSavedBands();
      const want = new Set(ids);
      const filtered = savedBands.filter((b) => want.has(b.id));
      if (filtered.length === 0) return "";
      return filtered.map(formatSavedBandContextLine).join("\n");
    },
  };
}

module.exports = { createTursoPreferenceRepository };
