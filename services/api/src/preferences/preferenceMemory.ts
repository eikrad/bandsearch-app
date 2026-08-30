import { randomUUID } from "node:crypto";
import { validateSavedBand as validateSavedBandInput } from "../../../../shared/schemas/src/contracts.js";
import type { PreferenceRepository } from "./preferenceRepository.js";

export { validateSavedBandInput };

const DEFAULT_USER = "anonymous";

type SavedBand = {
  id: string;
  userId: string;
  musicbrainzArtistId: string;
  name: string;
  rating: number;
  categories: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
};

type Group = {
  id: string;
  userId: string;
  name: string;
  memberIds: Set<string>;
};

type SavedBandInput = {
  musicbrainzArtistId: string;
  name: string;
  rating: number;
  categories: unknown[];
  note: string;
};

type BandUpdates = { rating?: number; categories?: string[]; note?: string };

function withoutUserId({ userId: _uid, ...rest }: SavedBand) {
  void _uid;
  return rest;
}

function toGroupView(g: Group) {
  return { id: g.id, name: g.name, memberIds: [...g.memberIds] };
}

export function createPreferenceMemory() {
  const savedBands: SavedBand[] = [];
  const groups: Group[] = [];

  return {
    async addSavedBand(input: unknown, userId = DEFAULT_USER) {
      const validation = validateSavedBandInput(input);
      if (validation.ok === false) {
        return validation;
      }

      const bandInput = input as SavedBandInput;
      const now = new Date().toISOString();
      const savedBand: SavedBand = {
        id: randomUUID(),
        userId,
        musicbrainzArtistId: bandInput.musicbrainzArtistId.trim(),
        name: bandInput.name.trim(),
        rating: bandInput.rating,
        categories: bandInput.categories.map((c: unknown) => String(c).trim()).filter(Boolean),
        note: bandInput.note.trim(),
        createdAt: now,
        updatedAt: now,
      };

      savedBands.push(savedBand);
      return { ok: true, savedBand: withoutUserId(savedBand) };
    },

    async listSavedBands(userId = DEFAULT_USER) {
      return savedBands.filter((b) => b.userId === userId).map(withoutUserId);
    },

    async updateSavedBand(id: string, updates: BandUpdates, userId = DEFAULT_USER) {
      const index = savedBands.findIndex((band) => band.id === id && band.userId === userId);
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

      if (validation.ok === false) {
        return { ok: false, status: 400, error: validation.error };
      }

      savedBands[index] = {
        ...current,
        rating: next.rating,
        categories: next.categories.map((c: unknown) => String(c).trim()).filter(Boolean),
        note: String(next.note).trim(),
        updatedAt: new Date().toISOString(),
      };

      return { ok: true, savedBand: withoutUserId(savedBands[index]) };
    },

    async deleteSavedBand(id: string, userId = DEFAULT_USER) {
      const index = savedBands.findIndex((band) => band.id === id && band.userId === userId);
      if (index === -1) {
        return { ok: false, status: 404, error: "saved band not found" };
      }

      const [deleted] = savedBands.splice(index, 1);
      // Matches ON DELETE CASCADE on artist_group_members.saved_band_id in the
      // SQLite and Turso schemas. Without it listGroups reports members that no
      // longer exist.
      for (const group of groups) {
        group.memberIds.delete(deleted.id);
      }
      return { ok: true, deletedId: deleted.id };
    },

    async importSavedBands(bands: unknown[], userId = DEFAULT_USER) {
      const existingIds = new Set(
        savedBands.filter((b) => b.userId === userId).map((b) => b.musicbrainzArtistId),
      );
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      for (const band of bands) {
        const b = band as Record<string, unknown>;
        const mid = String(b.musicbrainzArtistId ?? "");
        if (existingIds.has(mid)) {
          skipped++;
          continue;
        }
        const result = await this.addSavedBand(band, userId);
        if (result.ok === true) {
          existingIds.add(mid);
          imported++;
        } else {
          failed++;
        }
      }
      return { imported, skipped, failed };
    },

    async listGroups(userId = DEFAULT_USER) {
      return groups
        .filter((g) => g.userId === userId)
        // The SQLite and Turso adapters both `ORDER BY name ASC`, which SQLite
        // resolves with its BINARY collation — so compare raw, not by locale.
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map(toGroupView);
    },

    async createGroup(name: string, userId = DEFAULT_USER) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      if (groups.some((g) => g.userId === userId && g.name === trimmed))
        return { ok: false, status: 409, error: "group name already exists" };
      const id = randomUUID();
      const group: Group = { id, userId, name: trimmed, memberIds: new Set() };
      groups.push(group);
      return { ok: true, group: toGroupView(group) };
    },

    async renameGroup(id: string, name: string, userId = DEFAULT_USER) {
      const group = groups.find((g) => g.id === id && g.userId === userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      if (groups.some((g) => g.userId === userId && g.name === trimmed && g.id !== id))
        return { ok: false, status: 409, error: "group name already exists" };
      group.name = trimmed;
      return { ok: true, group: toGroupView(group) };
    },

    async deleteGroup(id: string, userId = DEFAULT_USER) {
      const index = groups.findIndex((g) => g.id === id && g.userId === userId);
      if (index === -1) return { ok: false, status: 404, error: "group not found" };
      groups.splice(index, 1);
      return { ok: true, deletedId: id };
    },

    async addArtistToGroup(groupId: string, savedBandId: string, userId = DEFAULT_USER) {
      const group = groups.find((g) => g.id === groupId && g.userId === userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      group.memberIds.add(savedBandId);
      return { ok: true };
    },

    async removeArtistFromGroup(groupId: string, savedBandId: string, userId = DEFAULT_USER) {
      const group = groups.find((g) => g.id === groupId && g.userId === userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      group.memberIds.delete(savedBandId);
      return { ok: true };
    },
  };
}

export function createInMemoryPreferenceRepository(): PreferenceRepository {
  return createPreferenceMemory();
}
