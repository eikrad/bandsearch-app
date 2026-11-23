/**
 * Deciding whether two spellings name the same artist. MusicBrainz's search
 * always returns its nearest names, so a hit proves nothing by itself:
 * "Watching the Rain" used to be verified as Oasis.
 */

const lower = (name: string) => name.trim().toLowerCase();

/** Case, accents, punctuation and spaces removed; the plain lower-case name when nothing else is left ("!!!"). */
function simplified(name: string): string {
  const letters = lower(name).normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
  return letters || lower(name);
}

/** The name without its leading English article: "The Moving Sidewalks" is also listed as "Moving Sidewalks". */
export function withoutArticle(name: string): string {
  return name.trim().replace(/^the\s+(?=\S)/i, "");
}

const closeness: Array<(a: string, b: string) => boolean> = [
  (a, b) => a.trim() === b.trim(),
  (a, b) => lower(a) === lower(b),
  (a, b) => simplified(a) === simplified(b),
  (a, b) => simplified(withoutArticle(a)) === simplified(withoutArticle(b)),
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
