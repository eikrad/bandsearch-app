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

    async listGroups() {
      const rows = db.prepare("SELECT * FROM artist_groups ORDER BY name ASC").all();
      return rows.map((g) => {
        const members = db.prepare("SELECT saved_band_id FROM artist_group_members WHERE group_id = ?").all(g.id);
        return { id: g.id, name: g.name, memberIds: members.map((m) => m.saved_band_id) };
      });
    },

    async createGroup(name) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const existing = db.prepare("SELECT id FROM artist_groups WHERE name = ?").get(trimmed);
      if (existing) return { ok: false, status: 409, error: "group name already exists" };
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO artist_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, trimmed, now, now);
      return { ok: true, group: { id, name: trimmed, memberIds: [] } };
    },

    async renameGroup(id, name) {
      const group = db.prepare("SELECT * FROM artist_groups WHERE id = ?").get(id);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const conflict = db.prepare("SELECT id FROM artist_groups WHERE name = ? AND id != ?").get(trimmed, id);
      if (conflict) return { ok: false, status: 409, error: "group name already exists" };
      const now = new Date().toISOString();
      db.prepare("UPDATE artist_groups SET name = ?, updated_at = ? WHERE id = ?").run(trimmed, now, id);
      const members = db.prepare("SELECT saved_band_id FROM artist_group_members WHERE group_id = ?").all(id);
      return { ok: true, group: { id, name: trimmed, memberIds: members.map((m) => m.saved_band_id) } };
    },

    async deleteGroup(id) {
      const result = db.prepare("DELETE FROM artist_groups WHERE id = ?").run(id);
      if (result.changes === 0) return { ok: false, status: 404, error: "group not found" };
      return { ok: true, deletedId: id };
    },

    async addArtistToGroup(groupId, savedBandId) {
      const group = db.prepare("SELECT id FROM artist_groups WHERE id = ?").get(groupId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      const now = new Date().toISOString();
      db.prepare("INSERT OR IGNORE INTO artist_group_members (group_id, saved_band_id, added_at) VALUES (?, ?, ?)").run(groupId, savedBandId, now);
      return { ok: true };
    },

    async removeArtistFromGroup(groupId, savedBandId) {
      const group = db.prepare("SELECT id FROM artist_groups WHERE id = ?").get(groupId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      db.prepare("DELETE FROM artist_group_members WHERE group_id = ? AND saved_band_id = ?").run(groupId, savedBandId);
      return { ok: true };
    },
  };
}

module.exports = { createSqlitePreferenceRepository };
