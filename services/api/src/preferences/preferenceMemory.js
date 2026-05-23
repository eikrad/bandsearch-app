const { randomUUID } = require("node:crypto");
const { validateSavedBand: validateSavedBandInput } = require("../../../../shared/schemas/src/contracts");
const { formatSavedBandContextLine } = require("./savedBandContextFormat");

function createPreferenceMemory() {
  const savedBands = [];
  const groups = [];

  function toGroupView(g) {
    return { id: g.id, name: g.name, memberIds: [...g.memberIds] };
  }

  return {
    async addSavedBand(input) {
      const validation = validateSavedBandInput(input);
      if (validation.ok === false) {
        return validation;
      }

      const now = new Date().toISOString();
      const savedBand = {
        id: randomUUID(),
        musicbrainzArtistId: input.musicbrainzArtistId.trim(),
        name: input.name.trim(),
        rating: input.rating,
        categories: input.categories.map((c) => String(c).trim()).filter(Boolean),
        note: input.note.trim(),
        createdAt: now,
        updatedAt: now,
      };

      savedBands.push(savedBand);
      return { ok: true, savedBand };
    },

    async listSavedBands() {
      return [...savedBands];
    },

    async updateSavedBand(id, updates) {
      const index = savedBands.findIndex((band) => band.id === id);
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

      return { ok: true, savedBand: savedBands[index] };
    },

    async deleteSavedBand(id) {
      const index = savedBands.findIndex((band) => band.id === id);
      if (index === -1) {
        return { ok: false, status: 404, error: "saved band not found" };
      }

      const [deleted] = savedBands.splice(index, 1);
      return { ok: true, deletedId: deleted.id };
    },

    async buildContext() {
      if (savedBands.length === 0) {
        return "";
      }

      return savedBands.map(formatSavedBandContextLine).join("\n");
    },

    async buildContextForIds(ids) {
      if (!ids || ids.length === 0) return "";
      const want = new Set(ids);
      const filtered = savedBands.filter((b) => want.has(b.id));
      if (filtered.length === 0) return "";
      return filtered.map(formatSavedBandContextLine).join("\n");
    },

    async importSavedBands(bands) {
      const existing = new Set(savedBands.map((b) => b.musicbrainzArtistId));
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
      return groups.map(toGroupView);
    },

    async createGroup(name) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      if (groups.some((g) => g.name === trimmed)) return { ok: false, status: 409, error: "group name already exists" };
      const { randomUUID } = require("node:crypto");
      const id = randomUUID();
      const group = { id, name: trimmed, memberIds: new Set() };
      groups.push(group);
      return { ok: true, group: toGroupView(group) };
    },

    async renameGroup(id, name) {
      const group = groups.find((g) => g.id === id);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      const trimmed = String(name || "").trim();
      if (!trimmed) return { ok: false, status: 400, error: "group name is required" };
      if (groups.some((g) => g.name === trimmed && g.id !== id)) return { ok: false, status: 409, error: "group name already exists" };
      group.name = trimmed;
      return { ok: true, group: toGroupView(group) };
    },

    async deleteGroup(id) {
      const index = groups.findIndex((g) => g.id === id);
      if (index === -1) return { ok: false, status: 404, error: "group not found" };
      groups.splice(index, 1);
      return { ok: true, deletedId: id };
    },

    async addArtistToGroup(groupId, savedBandId) {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      group.memberIds.add(savedBandId);
      return { ok: true };
    },

    async removeArtistFromGroup(groupId, savedBandId) {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return { ok: false, status: 404, error: "group not found" };
      group.memberIds.delete(savedBandId);
      return { ok: true };
    },
  };
}

function createInMemoryPreferenceRepository() {
  return createPreferenceMemory();
}

module.exports = {
  createPreferenceMemory,
  createInMemoryPreferenceRepository,
  validateSavedBandInput,
};
