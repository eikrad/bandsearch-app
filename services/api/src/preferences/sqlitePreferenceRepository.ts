/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { validateSavedBand as validateSavedBandInput } from "../../../../shared/schemas/src/contracts.js";
import { formatSavedBandContextLine } from "./savedBandContextFormat.js";

const DEFAULT_USER = "anonymous";

function mapRowToSavedBand(row: any) {
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

export function createSqlitePreferenceRepository({ db }: { db: Database }) {
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

      db.prepare(
        `INSERT INTO saved_bands
          (id, user_id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, userId, musicbrainzArtistId, name, input.rating, categories, note, now, now);

      const row = db.prepare("SELECT * FROM saved_bands WHERE id = ?").get(id);
      return { ok: true, savedBand: mapRowToSavedBand(row) };
    },

    async listSavedBands(userId = DEFAULT_USER) {
      const rows = db.prepare("SELECT * FROM saved_bands WHERE user_id = ? ORDER BY updated_at DESC").all(userId);
      return rows.map(mapRowToSavedBand);
    },

    async updateSavedBand(id: string, updates: any, userId = DEFAULT_USER) {
      const row = db.prepare("SELECT * FROM saved_bands WHERE id = ? AND user_id = ?").get(id, userId);
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
      if (validation.ok === false) return { ok: false, status: 400, error: (validation as any).error };

      const updatedAt = new Date().toISOString();
      db.prepare(
        `UPDATE saved_bands SET rating = ?, categories = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ).run(
        next.rating,
        JSON.stringify(next.categories.map((c: any) => String(c).trim()).filter(Boolean)),
        String(next.note).trim(),
        updatedAt,
        id,
        userId,
      );

      const updated = db.prepare("SELECT * FROM saved_bands WHERE id = ?").get(id);
      return { ok: true, savedBand: mapRowToSavedBand(updated) };
    },

    async deleteSavedBand(id: string, userId = DEFAULT_USER) {
      const result = db.prepare("DELETE FROM saved_bands WHERE id = ? AND user_id = ?").run(id, userId);
      if (result.changes === 0) return { ok: false, status: 404, error: "saved band not found" };
      return { ok: true, deletedId: id };
    },

    async buildContext(userId = DEFAULT_USER) {
      const savedBands = await this.listSavedBands(userId);
      if (savedBands.length === 0) return "";
      return savedBands.map(formatSavedBandContextLine).join("\n");
    },

    async buildContextForIds(ids: string[], userId = DEFAULT_USER) {
      if (!ids || ids.length === 0) return "";
      const placeholders = ids.map(() => "?").join(", ");
      const rows = db
        .prepare(`SELECT * FROM saved_bands WHERE user_id = ? AND id IN (${placeholders})`)
        .all(userId, ...ids);
      if (rows.length === 0) return "";
      return rows.map(mapRowToSavedBand).map(formatSavedBandContextLine).join("\n");
    },

    async importSavedBands(bands: any[], userId = DEFAULT_USER) {
      const existingRows = db
        .prepare("SELECT musicbrainz_artist_id FROM saved_bands WHERE user_id = ?")
        .all(userId) as any[];
      const existing = new Set(existingRows.map((r) => r.musicbrainz_artist_id));
      let imported = 0;
      let skipped = 0;
      for (const band of bands) {
        if (existing.has(band.musicbrainzArtistId)) {
          skipped++;
          continue;
        }
        const result = await this.addSavedBand(band, userId);
        if (result.ok) {
          existing.add(band.musicbrainzArtistId);
          imported++;
        }
      }
      return { imported, skipped };
    },

    async listGroups(userId = DEFAULT_USER) {
      const rows = db
        .prepare("SELECT * FROM artist_groups WHERE user_id = ? ORDER BY name ASC")
        .all(userId) as any[];
      return rows.map((g) => {
        const members = db
          .prepare("SELECT saved_band_id FROM artist_group_members WHERE group_id = ?")
          .all(g.id) as any[];
        return { id: g.id, name: g.name, memberIds: members.map((m) => m.saved_band_id) };
      });
    },

    async createGroup(name: string, userId = DEFAULT_USER) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const existing = db
        .prepare("SELECT id FROM artist_groups WHERE user_id = ? AND name = ?")
        .get(userId, trimmed);
      if (existing) return { ok: false, status: 409, error: "group name already exists" };
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        "INSERT INTO artist_groups (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, userId, trimmed, now, now);
      return { ok: true, group: { id, name: trimmed, memberIds: [] } };
    },

    async renameGroup(id: string, name: string, userId = DEFAULT_USER) {
      const group = db
        .prepare("SELECT * FROM artist_groups WHERE id = ? AND user_id = ?")
        .get(id, userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      const conflict = db
        .prepare("SELECT id FROM artist_groups WHERE user_id = ? AND name = ? AND id != ?")
        .get(userId, trimmed, id);
      if (conflict) return { ok: false, status: 409, error: "group name already exists" };
      const now = new Date().toISOString();
      db.prepare("UPDATE artist_groups SET name = ?, updated_at = ? WHERE id = ?").run(trimmed, now, id);
      const members = db
        .prepare("SELECT saved_band_id FROM artist_group_members WHERE group_id = ?")
        .all(id) as any[];
      return { ok: true, group: { id, name: trimmed, memberIds: members.map((m) => m.saved_band_id) } };
    },

    async deleteGroup(id: string, userId = DEFAULT_USER) {
      const result = db
        .prepare("DELETE FROM artist_groups WHERE id = ? AND user_id = ?")
        .run(id, userId);
      if (result.changes === 0) return { ok: false, status: 404, error: "group not found" };
      return { ok: true, deletedId: id };
    },

    async addArtistToGroup(groupId: string, savedBandId: string, userId = DEFAULT_USER) {
      const group = db
        .prepare("SELECT id FROM artist_groups WHERE id = ? AND user_id = ?")
        .get(groupId, userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      const now = new Date().toISOString();
      db.prepare(
        "INSERT OR IGNORE INTO artist_group_members (group_id, saved_band_id, added_at) VALUES (?, ?, ?)",
      ).run(groupId, savedBandId, now);
      return { ok: true };
    },

    async removeArtistFromGroup(groupId: string, savedBandId: string, userId = DEFAULT_USER) {
      const group = db
        .prepare("SELECT id FROM artist_groups WHERE id = ? AND user_id = ?")
        .get(groupId, userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      db.prepare(
        "DELETE FROM artist_group_members WHERE group_id = ? AND saved_band_id = ?",
      ).run(groupId, savedBandId);
      return { ok: true };
    },
  };
}
