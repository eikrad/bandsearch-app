/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { validateSavedBand as validateSavedBandInput } from "../../../../shared/schemas/src/contracts.js";
import { formatSavedBandContextLine } from "./savedBandContextFormat.js";

const DEFAULT_USER = "anonymous";

function mapRowToSavedBand(row: any) {
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

export function createTursoPreferenceRepository({ client }: { client: any }) {
  return {
    async addSavedBand(input: any, userId = DEFAULT_USER) {
      const validation = validateSavedBandInput(input);
      if (validation.ok === false) return validation;

      const id = randomUUID();
      const now = new Date().toISOString();
      const categories = JSON.stringify(input.categories.map((c: any) => String(c).trim()).filter(Boolean));
      const note = input.note.trim();
      const name = input.name.trim();
      const musicbrainzArtistId = input.musicbrainzArtistId.trim();

      const result = await client.execute({
        sql: `INSERT INTO saved_bands
                (id, user_id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              RETURNING *`,
        args: [id, userId, musicbrainzArtistId, name, input.rating, categories, note, now, now],
      });

      return { ok: true, savedBand: mapRowToSavedBand(result.rows[0]) };
    },

    async listSavedBands(userId = DEFAULT_USER) {
      const result = await client.execute({
        sql: "SELECT * FROM saved_bands WHERE user_id = ? ORDER BY updated_at DESC",
        args: [userId],
      });
      return result.rows.map(mapRowToSavedBand);
    },

    async updateSavedBand(id: string, updates: any, userId = DEFAULT_USER) {
      const selectResult = await client.execute({
        sql: "SELECT * FROM saved_bands WHERE id = ? AND user_id = ?",
        args: [id, userId],
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
      if (validation.ok === false) return { ok: false, status: 400, error: (validation as any).error };

      const normalizedCategories = JSON.stringify(next.categories.map((c: any) => String(c).trim()).filter(Boolean));
      const normalizedNote = String(next.note).trim();
      const updatedAt = new Date().toISOString();

      const updateResult = await client.execute({
        sql: `UPDATE saved_bands
              SET rating = ?, categories = ?, note = ?, updated_at = ?
              WHERE id = ? AND user_id = ?
              RETURNING *`,
        args: [next.rating, normalizedCategories, normalizedNote, updatedAt, id, userId],
      });

      return { ok: true, savedBand: mapRowToSavedBand(updateResult.rows[0]) };
    },

    async deleteSavedBand(id: string, userId = DEFAULT_USER) {
      const result = await client.execute({
        sql: "DELETE FROM saved_bands WHERE id = ? AND user_id = ?",
        args: [id, userId],
      });
      if (result.rowsAffected === 0) return { ok: false, status: 404, error: "saved band not found" };
      return { ok: true, deletedId: id };
    },

    async buildContext(userId = DEFAULT_USER) {
      const savedBands = await this.listSavedBands(userId);
      if (savedBands.length === 0) return "";
      return savedBands.map(formatSavedBandContextLine).join("\n");
    },

    async buildContextForIds(ids: string[], userId = DEFAULT_USER) {
      if (!ids || ids.length === 0) return "";
      const savedBands = await this.listSavedBands(userId);
      const want = new Set(ids);
      const filtered = savedBands.filter((b) => want.has(b.id));
      if (filtered.length === 0) return "";
      return filtered.map(formatSavedBandContextLine).join("\n");
    },

    async importSavedBands(bands: any[], userId = DEFAULT_USER) {
      const result = await client.execute({
        sql: "SELECT musicbrainz_artist_id FROM saved_bands WHERE user_id = ?",
        args: [userId],
      });
      const existing = new Set(result.rows.map((r: any) => r.musicbrainz_artist_id));
      let imported = 0;
      let skipped = 0;
      for (const band of bands) {
        if (existing.has(band.musicbrainzArtistId)) {
          skipped++;
          continue;
        }
        const addResult = await this.addSavedBand(band, userId);
        if (addResult.ok) {
          existing.add(band.musicbrainzArtistId);
          imported++;
        }
      }
      return { imported, skipped };
    },

    async listGroups(userId = DEFAULT_USER) {
      const res = await client.execute({
        sql: "SELECT * FROM artist_groups WHERE user_id = ? ORDER BY name ASC",
        args: [userId],
      });
      const results = [];
      for (const g of res.rows) {
        const members = await client.execute({
          sql: "SELECT saved_band_id FROM artist_group_members WHERE group_id = ?",
          args: [g.id],
        });
        results.push({ id: g.id, name: g.name, memberIds: members.rows.map((m: any) => m.saved_band_id) });
      }
      return results;
    },

    async createGroup(name: string, userId = DEFAULT_USER) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const existing = await client.execute({
        sql: "SELECT id FROM artist_groups WHERE name = ? AND user_id = ?",
        args: [trimmed, userId],
      });
      if (existing.rows.length > 0) return { ok: false, status: 409, error: "group name already exists" };
      const id = randomUUID();
      const now = new Date().toISOString();
      await client.execute({
        sql: "INSERT INTO artist_groups (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        args: [id, userId, trimmed, now, now],
      });
      return { ok: true, group: { id, name: trimmed, memberIds: [] } };
    },

    async renameGroup(id: string, name: string, userId = DEFAULT_USER) {
      const current = await client.execute({
        sql: "SELECT id FROM artist_groups WHERE id = ? AND user_id = ?",
        args: [id, userId],
      });
      if (current.rows.length === 0) return { ok: false, status: 404, error: "group not found" };
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const conflict = await client.execute({
        sql: "SELECT id FROM artist_groups WHERE name = ? AND user_id = ? AND id != ?",
        args: [trimmed, userId, id],
      });
      if (conflict.rows.length > 0) return { ok: false, status: 409, error: "group name already exists" };
      const now = new Date().toISOString();
      await client.execute({
        sql: "UPDATE artist_groups SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        args: [trimmed, now, id, userId],
      });
      const members = await client.execute({
        sql: "SELECT saved_band_id FROM artist_group_members WHERE group_id = ?",
        args: [id],
      });
      return { ok: true, group: { id, name: trimmed, memberIds: members.rows.map((m: any) => m.saved_band_id) } };
    },

    async deleteGroup(id: string, userId = DEFAULT_USER) {
      const result = await client.execute({
        sql: "DELETE FROM artist_groups WHERE id = ? AND user_id = ?",
        args: [id, userId],
      });
      if (result.rowsAffected === 0) return { ok: false, status: 404, error: "group not found" };
      return { ok: true, deletedId: id };
    },

    async addArtistToGroup(groupId: string, savedBandId: string, userId = DEFAULT_USER) {
      const group = await client.execute({
        sql: "SELECT id FROM artist_groups WHERE id = ? AND user_id = ?",
        args: [groupId, userId],
      });
      if (group.rows.length === 0) return { ok: false, status: 404, error: "group not found" };
      const now = new Date().toISOString();
      await client.execute({
        sql: "INSERT OR IGNORE INTO artist_group_members (group_id, saved_band_id, added_at) VALUES (?, ?, ?)",
        args: [groupId, savedBandId, now],
      });
      return { ok: true };
    },

    async removeArtistFromGroup(groupId: string, savedBandId: string, userId = DEFAULT_USER) {
      const group = await client.execute({
        sql: "SELECT id FROM artist_groups WHERE id = ? AND user_id = ?",
        args: [groupId, userId],
      });
      if (group.rows.length === 0) return { ok: false, status: 404, error: "group not found" };
      await client.execute({
        sql: "DELETE FROM artist_group_members WHERE group_id = ? AND saved_band_id = ?",
        args: [groupId, savedBandId],
      });
      return { ok: true };
    },
  };
}
