const { randomUUID } = require("node:crypto");
const { validateSavedBand: validateSavedBandInput } = require("../../../../shared/schemas/src/contracts");
const { formatSavedBandContextLine } = require("./savedBandContextFormat");

const DEFAULT_USER = "anonymous";

function createPreferenceMemory() {
  const savedBands = [];
  const groups = [];

  function toGroupView(g) {
    return { id: g.id, name: g.name, memberIds: [...g.memberIds] };
  }

  return {
    async addSavedBand(input, userId = DEFAULT_USER) {
      const validation = validateSavedBandInput(input);
      if (validation.ok === false) {
        return validation;
      }

      const now = new Date().toISOString();
      const savedBand = {
        id: randomUUID(),
        userId,
        musicbrainzArtistId: input.musicbrainzArtistId.trim(),
        name: input.name.trim(),
        rating: input.rating,
        categories: input.categories.map((c) => String(c).trim()).filter(Boolean),
        note: input.note.trim(),
        createdAt: now,
        updatedAt: now,
      };

      savedBands.push(savedBand);
      return { ok: true, savedBand: withoutUserId(savedBand) };
    },

    async listSavedBands(userId = DEFAULT_USER) {
      return savedBands.filter((b) => b.userId === userId).map(withoutUserId);
    },

    async updateSavedBand(id, updates, userId = DEFAULT_USER) {
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
        categories: next.categories.map((c) => String(c).trim()).filter(Boolean),
        note: String(next.note).trim(),
        updatedAt: new Date().toISOString(),
      };

      return { ok: true, savedBand: withoutUserId(savedBands[index]) };
    },

    async deleteSavedBand(id, userId = DEFAULT_USER) {
      const index = savedBands.findIndex((band) => band.id === id && band.userId === userId);
      if (index === -1) {
        return { ok: false, status: 404, error: "saved band not found" };
      }

      const [deleted] = savedBands.splice(index, 1);
      return { ok: true, deletedId: deleted.id };
    },

    async buildContext(userId = DEFAULT_USER) {
      const userBands = savedBands.filter((b) => b.userId === userId);
      if (userBands.length === 0) return "";
      return userBands.map(withoutUserId).map(formatSavedBandContextLine).join("\n");
    },

    async buildContextForIds(ids, userId = DEFAULT_USER) {
      if (!ids || ids.length === 0) return "";
      const want = new Set(ids);
      const filtered = savedBands.filter((b) => b.userId === userId && want.has(b.id));
      if (filtered.length === 0) return "";
      return filtered.map(withoutUserId).map(formatSavedBandContextLine).join("\n");
    },

    async importSavedBands(bands, userId = DEFAULT_USER) {
      const existingIds = new Set(
        savedBands.filter((b) => b.userId === userId).map((b) => b.musicbrainzArtistId)
      );
      let imported = 0;
      let skipped = 0;
      for (const band of bands) {
        if (existingIds.has(band.musicbrainzArtistId)) {
          skipped++;
          continue;
        }
        const result = await this.addSavedBand(band, userId);
        if (result.ok) {
          existingIds.add(band.musicbrainzArtistId);
          imported++;
        }
      }
      return { imported, skipped };
    },

    async listGroups(userId = DEFAULT_USER) {
      return groups.filter((g) => g.userId === userId).map(toGroupView);
    },

    async createGroup(name, userId = DEFAULT_USER) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      if (groups.some((g) => g.userId === userId && g.name === trimmed))
        return { ok: false, status: 409, error: "group name already exists" };
      const id = randomUUID();
      const group = { id, userId, name: trimmed, memberIds: new Set() };
      groups.push(group);
      return { ok: true, group: toGroupView(group) };
    },

    async renameGroup(id, name, userId = DEFAULT_USER) {
      const group = groups.find((g) => g.id === id && g.userId === userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      if (groups.some((g) => g.userId === userId && g.name === trimmed && g.id !== id))
        return { ok: false, status: 409, error: "group name already exists" };
      group.name = trimmed;
      return { ok: true, group: toGroupView(group) };
    },

    async deleteGroup(id, userId = DEFAULT_USER) {
      const index = groups.findIndex((g) => g.id === id && g.userId === userId);
      if (index === -1) return { ok: false, status: 404, error: "group not found" };
      groups.splice(index, 1);
      return { ok: true, deletedId: id };
    },

    async addArtistToGroup(groupId, savedBandId, userId = DEFAULT_USER) {
      const group = groups.find((g) => g.id === groupId && g.userId === userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      group.memberIds.add(savedBandId);
      return { ok: true };
    },

    async removeArtistFromGroup(groupId, savedBandId, userId = DEFAULT_USER) {
      const group = groups.find((g) => g.id === groupId && g.userId === userId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      group.memberIds.delete(savedBandId);
      return { ok: true };
    },
  };
}

function withoutUserId({ userId: _uid, ...rest }) { // eslint-disable-line no-unused-vars
  return rest;
}

function createInMemoryPreferenceRepository() {
  return createPreferenceMemory();
}

module.exports = {
  createPreferenceMemory,
  createInMemoryPreferenceRepository,
  validateSavedBandInput,
};
