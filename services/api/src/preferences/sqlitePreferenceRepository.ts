import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { validateSavedBand as validateSavedBandInput } from "../../../../shared/schemas/src/contracts.js";
import type { PreferenceRepository } from "./preferenceRepository.js";

const DEFAULT_USER = "anonymous";

type SavedBandRow = {
  id: string;
  user_id: string;
  musicbrainz_artist_id: string;
  name: string;
  rating: number | null;
  categories: string;
  note: string;
  created_at: string;
  updated_at: string;
};

type GroupRow = { id: string; name: string };
type MemberRow = { saved_band_id: string };
type MusicbrainzIdRow = { musicbrainz_artist_id: string };

type SavedBandInput = {
  musicbrainzArtistId: string;
  name: string;
  rating: number | null;
  categories: unknown[];
  note: string;
};

type BandUpdates = { rating?: number | null; categories?: string[]; note?: string };

function mapRowToSavedBand(row: SavedBandRow) {
  return {
    id: row.id,
    musicbrainzArtistId: row.musicbrainz_artist_id,
    name: row.name,
    rating: row.rating,
    categories: JSON.parse(row.categories || "[]") as string[],
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSqlitePreferenceRepository({ db }: { db: Database }): PreferenceRepository {
  return {
    async addSavedBand(input: unknown, userId = DEFAULT_USER) {
      const validation = validateSavedBandInput(input);
      if (validation.ok === false) return validation;

      const bandInput = input as SavedBandInput;
      const id = randomUUID();
      const now = new Date().toISOString();
      const categories = JSON.stringify(bandInput.categories.map((c: unknown) => String(c).trim()).filter(Boolean));
      const note = bandInput.note.trim();
      const name = bandInput.name.trim();
      const musicbrainzArtistId = bandInput.musicbrainzArtistId.trim();

      db.prepare(
        `INSERT INTO saved_bands
          (id, user_id, musicbrainz_artist_id, name, rating, categories, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, userId, musicbrainzArtistId, name, bandInput.rating ?? null, categories, note, now, now);

      const row = db.prepare("SELECT * FROM saved_bands WHERE id = ?").get(id) as SavedBandRow;
      return { ok: true, savedBand: mapRowToSavedBand(row) };
    },

    async listSavedBands(userId = DEFAULT_USER) {
      const rows = db.prepare("SELECT * FROM saved_bands WHERE user_id = ? ORDER BY updated_at DESC").all(userId) as SavedBandRow[];
      return rows.map(mapRowToSavedBand);
    },

    async updateSavedBand(id: string, updates: BandUpdates, userId = DEFAULT_USER) {
      const row = db.prepare("SELECT * FROM saved_bands WHERE id = ? AND user_id = ?").get(id, userId) as SavedBandRow | undefined;
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
        `UPDATE saved_bands SET rating = ?, categories = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      ).run(
        next.rating,
        JSON.stringify(next.categories.map((c: unknown) => String(c).trim()).filter(Boolean)),
        String(next.note).trim(),
        updatedAt,
        id,
        userId,
      );

      const updated = db.prepare("SELECT * FROM saved_bands WHERE id = ?").get(id) as SavedBandRow;
      return { ok: true, savedBand: mapRowToSavedBand(updated) };
    },

    async deleteSavedBand(id: string, userId = DEFAULT_USER) {
      const result = db.prepare("DELETE FROM saved_bands WHERE id = ? AND user_id = ?").run(id, userId);
      if (result.changes === 0) return { ok: false, status: 404, error: "saved band not found" };
      return { ok: true, deletedId: id };
    },

    async importSavedBands(bands: unknown[], userId = DEFAULT_USER) {
      const existingRows = db
        .prepare("SELECT musicbrainz_artist_id FROM saved_bands WHERE user_id = ?")
        .all(userId) as MusicbrainzIdRow[];
      const existing = new Set(existingRows.map((r) => r.musicbrainz_artist_id));
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      for (const band of bands) {
        const b = band as Record<string, unknown>;
        const mid = String(b.musicbrainzArtistId ?? "");
        if (existing.has(mid)) {
          skipped++;
          continue;
        }
        const result = await this.addSavedBand(band, userId);
        if (result.ok === true) {
          existing.add(mid);
          imported++;
        } else {
          failed++;
        }
      }
      return { imported, skipped, failed };
    },

    async listGroups(userId = DEFAULT_USER) {
      const rows = db
        .prepare("SELECT * FROM artist_groups WHERE user_id = ? ORDER BY name ASC")
        .all(userId) as GroupRow[];
      return rows.map((g) => {
        const members = db
          .prepare("SELECT saved_band_id FROM artist_group_members WHERE group_id = ?")
          .all(g.id) as MemberRow[];
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
        .all(id) as MemberRow[];
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

