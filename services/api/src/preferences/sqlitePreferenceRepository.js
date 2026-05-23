const { randomUUID } = require("node:crypto");
const { validateSavedBand: validateSavedBandInput } = require("../../../../shared/schemas/src/contracts");
const { formatSavedBandContextLine } = require("./savedBandContextFormat");

function mapRowToSavedBand(row) {
  return {
    id: row.id,
    musicbrainzArtistId: row.musicbrainz_artist_id,
    name: row.name,
    rating: row.rating,
    categories: JSON.parse(row.categories || "[]"),
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createSqlitePreferenceRepository({ db }) {
  return {
    async addSavedBand(input) {
      const validation = validateSavedBandInput(input);
      if (validation.ok === false) return validation;

      const id = randomUUID();
      const now = new Date().toISOString();
      const categories = JSON.stringify(input.categories.map((c) => String(c).trim()).filter(Boolean));
      const note = input.note.trim();
      const name = input.name.trim();
      const musicbrainzArtistId = input.musicbrainzArtistId.trim();

      db.prepare(
        `INSERT INTO saved_bands
          (id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, musicbrainzArtistId, name, input.rating, categories, note, now, now);

      const row = db.prepare("SELECT * FROM saved_bands WHERE id = ?").get(id);
      return { ok: true, savedBand: mapRowToSavedBand(row) };
    },

    async listSavedBands() {
      const rows = db.prepare("SELECT * FROM saved_bands ORDER BY updated_at DESC").all();
      return rows.map(mapRowToSavedBand);
    },

    async updateSavedBand(id, updates) {
      const row = db.prepare("SELECT * FROM saved_bands WHERE id = ?").get(id);
      if (!row) return { ok: false, status: 404, error: "saved band not found" };

      const current = mapRowToSavedBand(row);
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
      if (validation.ok === false) return { ok: false, status: 400, error: validation.error };

      const updatedAt = new Date().toISOString();
      db.prepare(
        `UPDATE saved_bands SET rating = ?, categories = ?, note = ?, updated_at = ? WHERE id = ?`,
      ).run(next.rating, JSON.stringify(next.categories.map((c) => String(c).trim()).filter(Boolean)), String(next.note).trim(), updatedAt, id);

      const updated = db.prepare("SELECT * FROM saved_bands WHERE id = ?").get(id);
      return { ok: true, savedBand: mapRowToSavedBand(updated) };
    },

    async deleteSavedBand(id) {
      const result = db.prepare("DELETE FROM saved_bands WHERE id = ?").run(id);
      if (result.changes === 0) return { ok: false, status: 404, error: "saved band not found" };
      return { ok: true, deletedId: id };
    },

    async buildContext() {
      const savedBands = await this.listSavedBands();
      if (savedBands.length === 0) return "";
      return savedBands.map(formatSavedBandContextLine).join("\n");
    },

    async buildContextForIds(ids) {
      if (!ids || ids.length === 0) return "";
      const placeholders = ids.map(() => "?").join(", ");
      const rows = db.prepare(`SELECT * FROM saved_bands WHERE id IN (${placeholders})`).all(...ids);
      if (rows.length === 0) return "";
      return rows.map(mapRowToSavedBand).map(formatSavedBandContextLine).join("\n");
    },

    async importSavedBands(bands) {
      const existingRows = db.prepare("SELECT musicbrainz_artist_id FROM saved_bands").all();
      const existing = new Set(existingRows.map((r) => r.musicbrainz_artist_id));
      let imported = 0;
      let skipped = 0;
      for (const band of bands) {
        if (existing.has(band.musicbrainzArtistId)) {
          skipped++;
          continue;
        }
        const result = await this.addSavedBand(band);
        if (result.ok) {
          existing.add(band.musicbrainzArtistId);
          imported++;
        }
      }
      return { imported, skipped };
    },
  };
}

module.exports = { createSqlitePreferenceRepository };
