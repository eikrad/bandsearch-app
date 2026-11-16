import type { createChatClient } from "./chatClient.js";
import type { SavedBand } from "./domain.js";

/** Identity and provenance from the selected card or artist-search result. */
export type SavedBandTarget = {
  name: string;
  musicbrainzArtistId?: string;
  suggestedNote?: string;
};

export type CategoryNoteUpdates = { categories?: string[]; note?: string };

function normalizeArtistId(artistName: string): string {
  return `local-${String(artistName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

/** The same identity rule drives card state and every saved-band write. */
export function findSavedBand(target: SavedBandTarget, bands: SavedBand[]): SavedBand | undefined {
  const mbid = target.musicbrainzArtistId?.trim();
  if (mbid) return bands.find((band) => band.musicbrainzArtistId?.trim() === mbid);
  const fallbackId = normalizeArtistId(target.name);
  return bands.find((band) => normalizeArtistId(band.name) === fallbackId);
}

type SavedBandClient = Pick<ReturnType<typeof createChatClient>,
  "createPreference" | "updatePreference" | "deletePreference" | "listPreferences">;

export function createSavedBandActions({
  client,
  getSavedBands,
  setSavedBands,
}: {
  client: SavedBandClient;
  getSavedBands(): SavedBand[];
  setSavedBands(bands: SavedBand[]): void;
}) {
  // Keep writes in interaction order: a slow create must not overwrite a
  // later rating or annotation, and a failed write must not block a retry.
  let pendingWrite = Promise.resolve();
  function write<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = pendingWrite.then(operation);
    pendingWrite = result.then(() => undefined, () => undefined);
    return result;
  }

  function remember(savedBand: SavedBand): SavedBand {
    const bands = getSavedBands();
    const existing = bands.some((band) => band.id === savedBand.id);
    setSavedBands(existing
      ? bands.map((band) => band.id === savedBand.id ? savedBand : band)
      : [...bands, savedBand]);
    return savedBand;
  }

  async function ensureSaved(target: SavedBandTarget): Promise<SavedBand> {
    const existing = findSavedBand(target, getSavedBands());
    if (existing) return existing;
    // Chat can be used before the saved-artists screen has loaded the collection.
    // POST is an upsert, so creating from an empty cache could erase annotations.
    const storedBands = await client.listPreferences();
    setSavedBands(storedBands);
    const stored = findSavedBand(target, storedBands);
    if (stored) return stored;
    const result = await client.createPreference({
      musicbrainzArtistId: target.musicbrainzArtistId?.trim() || normalizeArtistId(target.name),
      name: target.name,
      rating: null,
      categories: [],
      note: target.suggestedNote ?? "Saved from recommendation card.",
    });
    return remember(result.savedBand);
  }

  return {
    saveBand(target: SavedBandTarget): Promise<SavedBand> {
      return write(() => ensureSaved(target));
    },
    rateBand(target: SavedBandTarget, rating: number | null): Promise<SavedBand> {
      return write(async () => {
        const band = await ensureSaved(target);
        const result = await client.updatePreference(band.id, { rating });
        return remember(result.savedBand);
      });
    },
    saveCategoryNote(target: SavedBandTarget, updates: CategoryNoteUpdates): Promise<SavedBand> {
      return write(async () => {
        const band = await ensureSaved(target);
        if (updates.categories === undefined && updates.note === undefined) return band;
        const result = await client.updatePreference(band.id, updates);
        return remember(result.savedBand);
      });
    },
    deleteSavedBand(id: string): Promise<void> {
      return write(async () => {
        await client.deletePreference(id);
        setSavedBands(getSavedBands().filter((band) => band.id !== id));
      });
    },
  };
}
