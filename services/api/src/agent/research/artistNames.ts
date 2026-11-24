/**
 * Deciding whether two spellings name the same artist. MusicBrainz's search
 * always returns its nearest names, so a hit proves nothing by itself:
 * "Watching the Rain" used to be verified as Oasis.
 *
 * What counts as the same spelling is artist identity's rule (#366); this
 * module only orders it for choosing among MusicBrainz's results.
 */
import { isSameArtist, mayBeSameArtist } from "../../../../../shared/schemas/src/artistIdentity.js";

const lower = (name: string) => name.trim().toLowerCase();

/** Closest first: verification never accepts a spelling that is only possibly the artist. */
const closeness: Array<(a: string, b: string) => boolean> = [
  (a, b) => a.trim() === b.trim(),
  (a, b) => lower(a) === lower(b),
  (a, b) => isSameArtist({ name: a }, { name: b }),
];

type NamedArtist = { name: string; score: number; aliases: string[] };

/**
 * The artist a name refers to: the closest spelling of its name, else of an
 * alias; among equally close ones the best search score. Null when every
 * artist merely resembles the name.
 */
export function findArtistNamed<T extends NamedArtist>(name: string, artists: T[]): T | null {
  for (const spellingsOf of [(a: T) => [a.name], (a: T) => a.aliases]) {
    for (const isClose of closeness) {
      const matches = artists.filter((a) => spellingsOf(a).some((spelling) => isClose(name, spelling)));
      if (matches.length > 0) return matches.reduce((best, a) => (a.score > best.score ? a : best));
    }
  }
  return null;
}

/** An anchor artist of the request, under any spelling of it: anchors are never candidates. */
export function isAnchorArtist(name: string, anchorArtists: readonly string[]): boolean {
  return anchorArtists.some((anchor) => mayBeSameArtist({ name: anchor }, { name }));
}
