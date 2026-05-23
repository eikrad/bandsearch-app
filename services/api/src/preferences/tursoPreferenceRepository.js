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
      if (validation.ok === false) return validation;

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
      if (validation.ok === false) return { ok: false, status: 400, error: validation.error };

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

    async importSavedBands(bands) {
      const result = await client.execute({ sql: "SELECT musicbrainz_artist_id FROM saved_bands", args: [] });
      const existing = new Set(result.rows.map((r) => r.musicbrainz_artist_id));
      let imported = 0;
      let skipped = 0;
      for (const band of bands) {
        if (existing.has(band.musicbrainzArtistId)) {
          skipped++;
          continue;
        }
        const addResult = await this.addSavedBand(band);
        if (addResult.ok) {
          existing.add(band.musicbrainzArtistId);
          imported++;
        }
      }
      return { imported, skipped };
    },

    async listGroups() {
      const res = await client.execute({ sql: "SELECT * FROM artist_groups ORDER BY name ASC", args: [] });
      const results = [];
      for (const g of res.rows) {
        const members = await client.execute({ sql: "SELECT saved_band_id FROM artist_group_members WHERE group_id = ?", args: [g.id] });
        results.push({ id: g.id, name: g.name, memberIds: members.rows.map((m) => m.saved_band_id) });
      }
      return results;
    },

    async createGroup(name) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const existing = await client.execute({ sql: "SELECT id FROM artist_groups WHERE name = ?", args: [trimmed] });
      if (existing.rows.length > 0) return { ok: false, status: 409, error: "group name already exists" };
      const { randomUUID } = require("node:crypto");
      const id = randomUUID();
      const now = new Date().toISOString();
      await client.execute({ sql: "INSERT INTO artist_groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)", args: [id, trimmed, now, now] });
      return { ok: true, group: { id, name: trimmed, memberIds: [] } };
    },

    async renameGroup(id, name) {
      const current = await client.execute({ sql: "SELECT id FROM artist_groups WHERE id = ?", args: [id] });
      if (current.rows.length === 0) return { ok: false, status: 404, error: "group not found" };
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const conflict = await client.execute({ sql: "SELECT id FROM artist_groups WHERE name = ? AND id != ?", args: [trimmed, id] });
      if (conflict.rows.length > 0) return { ok: false, status: 409, error: "group name already exists" };
      const now = new Date().toISOString();
      await client.execute({ sql: "UPDATE artist_groups SET name = ?, updated_at = ? WHERE id = ?", args: [trimmed, now, id] });
      const members = await client.execute({ sql: "SELECT saved_band_id FROM artist_group_members WHERE group_id = ?", args: [id] });
      return { ok: true, group: { id, name: trimmed, memberIds: members.rows.map((m) => m.saved_band_id) } };
    },

    async deleteGroup(id) {
      const result = await client.execute({ sql: "DELETE FROM artist_groups WHERE id = ?", args: [id] });
      if (result.rowsAffected === 0) return { ok: false, status: 404, error: "group not found" };
      return { ok: true, deletedId: id };
    },

    async addArtistToGroup(groupId, savedBandId) {
      const group = await client.execute({ sql: "SELECT id FROM artist_groups WHERE id = ?", args: [groupId] });
      if (group.rows.length === 0) return { ok: false, status: 404, error: "group not found" };
      const now = new Date().toISOString();
      await client.execute({ sql: "INSERT OR IGNORE INTO artist_group_members (group_id, saved_band_id, added_at) VALUES (?, ?, ?)", args: [groupId, savedBandId, now] });
      return { ok: true };
    },

    async removeArtistFromGroup(groupId, savedBandId) {
      const group = await client.execute({ sql: "SELECT id FROM artist_groups WHERE id = ?", args: [groupId] });
      if (group.rows.length === 0) return { ok: false, status: 404, error: "group not found" };
      await client.execute({ sql: "DELETE FROM artist_group_members WHERE group_id = ? AND saved_band_id = ?", args: [groupId, savedBandId] });
      return { ok: true };
    },
  };
}

module.exports = { createTursoPreferenceRepository };
