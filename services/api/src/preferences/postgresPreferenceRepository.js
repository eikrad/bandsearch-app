const { randomUUID } = require("node:crypto");
const { validateSavedBand: validateSavedBandInput } = require("../../../../shared/schemas/src/contracts");

const { formatSavedBandContextLine } = require("./savedBandContextFormat");

function mapRowToSavedBand(row) {
  return {
    id: row.id,
    musicbrainzArtistId: row.musicbrainz_artist_id,
    name: row.name,
    rating: row.rating,
    categories: row.categories || [],
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createPostgresPreferenceRepository({ pool }) {
  return {
    async addSavedBand(input) {
      const validation = validateSavedBandInput(input);
      if (validation.ok === false) {
        return validation;
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      const categories = input.categories.map((c) => String(c).trim()).filter(Boolean);
      const note = input.note.trim();
      const name = input.name.trim();
      const musicbrainzArtistId = input.musicbrainzArtistId.trim();

      const { rows } = await pool.query(
        `INSERT INTO saved_bands
          (id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [id, musicbrainzArtistId, name, input.rating, categories, note, now, now],
      );

      return { ok: true, savedBand: mapRowToSavedBand(rows[0]) };
    },

    async listSavedBands() {
      const { rows } = await pool.query("SELECT * FROM saved_bands ORDER BY updated_at DESC");
      return rows.map(mapRowToSavedBand);
    },

    async updateSavedBand(id, updates) {
      const currentResult = await pool.query("SELECT * FROM saved_bands WHERE id = $1", [id]);
      if (currentResult.rowCount === 0) {
        return { ok: false, status: 404, error: "saved band not found" };
      }

      const current = mapRowToSavedBand(currentResult.rows[0]);
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
      if (validation.ok === false) {
        return { ok: false, status: 400, error: validation.error };
      }

      const normalizedCategories = next.categories.map((c) => String(c).trim()).filter(Boolean);
      const normalizedNote = String(next.note).trim();
      const updatedAt = new Date().toISOString();

      const { rows } = await pool.query(
        `UPDATE saved_bands
           SET rating = $2, categories = $3, note = $4, updated_at = $5
         WHERE id = $1
         RETURNING *`,
        [id, next.rating, normalizedCategories, normalizedNote, updatedAt],
      );

      return { ok: true, savedBand: mapRowToSavedBand(rows[0]) };
    },

    async deleteSavedBand(id) {
      const { rowCount } = await pool.query("DELETE FROM saved_bands WHERE id = $1", [id]);
      if (rowCount === 0) {
        return { ok: false, status: 404, error: "saved band not found" };
      }
      return { ok: true, deletedId: id };
    },

    async buildContext() {
      const savedBands = await this.listSavedBands();
      if (savedBands.length === 0) {
        return "";
      }
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

    async importSavedBands(bands) {
      const { rows: existingRows } = await pool.query("SELECT musicbrainz_artist_id FROM saved_bands");
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
      const { rows } = await pool.query("SELECT * FROM artist_groups ORDER BY name ASC");
      const results = [];
      for (const g of rows) {
        const { rows: members } = await pool.query("SELECT saved_band_id FROM artist_group_members WHERE group_id = $1", [g.id]);
        results.push({ id: g.id, name: g.name, memberIds: members.map((m) => m.saved_band_id) });
      }
      return results;
    },

    async createGroup(name) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const existing = await pool.query("SELECT id FROM artist_groups WHERE name = $1", [trimmed]);
      if (existing.rowCount > 0) return { ok: false, status: 409, error: "group name already exists" };
      const { randomUUID } = require("node:crypto");
      const id = randomUUID();
      const now = new Date().toISOString();
      await pool.query("INSERT INTO artist_groups (id, name, created_at, updated_at) VALUES ($1, $2, $3, $4)", [id, trimmed, now, now]);
      return { ok: true, group: { id, name: trimmed, memberIds: [] } };
    },

    async renameGroup(id, name) {
      const current = await pool.query("SELECT id FROM artist_groups WHERE id = $1", [id]);
      if (current.rowCount === 0) return { ok: false, status: 404, error: "group not found" };
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const conflict = await pool.query("SELECT id FROM artist_groups WHERE name = $1 AND id != $2", [trimmed, id]);
      if (conflict.rowCount > 0) return { ok: false, status: 409, error: "group name already exists" };
      const now = new Date().toISOString();
      await pool.query("UPDATE artist_groups SET name = $1, updated_at = $2 WHERE id = $3", [trimmed, now, id]);
      const { rows: members } = await pool.query("SELECT saved_band_id FROM artist_group_members WHERE group_id = $1", [id]);
      return { ok: true, group: { id, name: trimmed, memberIds: members.map((m) => m.saved_band_id) } };
    },

    async deleteGroup(id) {
      const { rowCount } = await pool.query("DELETE FROM artist_groups WHERE id = $1", [id]);
      if (rowCount === 0) return { ok: false, status: 404, error: "group not found" };
      return { ok: true, deletedId: id };
    },

    async addArtistToGroup(groupId, savedBandId) {
      const group = await pool.query("SELECT id FROM artist_groups WHERE id = $1", [groupId]);
      if (group.rowCount === 0) return { ok: false, status: 404, error: "group not found" };
      const now = new Date().toISOString();
      await pool.query("INSERT INTO artist_group_members (group_id, saved_band_id, added_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [groupId, savedBandId, now]);
      return { ok: true };
    },

    async removeArtistFromGroup(groupId, savedBandId) {
      const group = await pool.query("SELECT id FROM artist_groups WHERE id = $1", [groupId]);
      if (group.rowCount === 0) return { ok: false, status: 404, error: "group not found" };
      await pool.query("DELETE FROM artist_group_members WHERE group_id = $1 AND saved_band_id = $2", [groupId, savedBandId]);
      return { ok: true };
    },
  };
}

module.exports = {
  createPostgresPreferenceRepository,
};
