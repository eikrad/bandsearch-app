import { foldArtistName, isSameArtist, realMusicBrainzId } from "../../../shared/schemas/src/artistIdentity.js";
import type { createChatClient } from "./chatClient.js";
import type { SavedBand } from "./domain.js";

/** Identity and provenance from the selected card or artist-search result. */
export type SavedBandTarget = {
  name: string;
  musicbrainzArtistId?: string;
  suggestedNote?: string;
};

export type CategoryNoteUpdates = { categories?: string[]; note?: string };

/** The stand-in ID of an artist MusicBrainz did not identify; artist identity reads it as no ID. */
function localArtistId(artistName: string): string {
  return `local-${foldArtistName(String(artistName || "")) || "unknown"}`;
}

/**
 * The same identity rule drives card state and every saved-band write
 * (artist identity, #366). A MusicBrainz ID is authoritative: a card with one
 * finds only the band saved under it. A card without one finds the band whose
 * name is the same artist's. A band that is only possibly the same is not
 * taken: that needs the user's word (#367).
 */
export function findSavedBand(target: SavedBandTarget, bands: SavedBand[]): SavedBand | undefined {
  const mbid = realMusicBrainzId(target.musicbrainzArtistId);
  if (mbid) return bands.find((band) => realMusicBrainzId(band.musicbrainzArtistId) === mbid);
  return bands.find((band) => isSameArtist({ name: target.name }, { name: band.name }));
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
      musicbrainzArtistId: target.musicbrainzArtistId?.trim() || localArtistId(target.name),
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
