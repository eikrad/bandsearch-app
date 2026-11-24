/**
 * Artist identity: the one rule for whether two mentions name the same artist
 * (#366). The search, conversation memory, the eval and the desktop's saved
 * bands all decide by it, so none of them restates it.
 *
 * - A real MusicBrainz ID decides when both sides have one. A saved band's
 *   `local-…` ID is not one.
 * - Otherwise the folded names decide: case, spacing, punctuation, the accent
 *   marks acute, grave and circumflex, and one definite article are ignored.
 * - ä ö ü ø å æ ß are letters of their own. A spelling with the plain letter or
 *   the transliteration ("Arzte", "Aerzte" for "Ärzte") is only *possibly* the
 *   same artist, as is a matching name with an ID on one side only.
 *
 * Each caller chooses what a "possibly" means for it: verification accepts
 * only "same", the search and the eval treat "possibly" as the same artist,
 * and saved bands ask the user.
 */

export type ArtistRef = {
  name: string;
  canonicalName?: string | null;
  mbid?: string | null;
};

export type ArtistMatch = "same" | "possibly" | "different";

/** Definite articles, in the order of CONTEXT.md: English, German, Danish, Dutch, French, Spanish. */
const ARTICLES = ["the", "der", "die", "das", "den", "det", "de", "het", "le", "la", "les", "el", "los", "las"];
const ARTICLE = ARTICLES.join("|");
const LEADING_ARTICLE = new RegExp(`^(?:(?:${ARTICLE})\\s+|l['’]|['’]t\\s+)(?=\\S)`, "u");
const TRAILING_ARTICLE = new RegExp(`,\\s*(?:${ARTICLE}|l['’]|['’]t)$`, "u");

/** Combining acute, grave and circumflex: the only marks that do not make a letter of its own. */
const FOLDED_MARKS = /[̀́̂]/gu;

/** Letters of their own, and the spellings they are written as when a keyboard lacks them. */
const LETTER_VARIANTS: Record<string, string[]> = {
  ä: ["a", "ae"],
  ö: ["o", "oe"],
  ü: ["u", "ue"],
  ø: ["o", "oe"],
  å: ["a", "aa"],
  æ: ["ae"],
  ß: ["ss"],
};
const MAX_VARIANTS = 256;

/** A saved band's stand-in ID for an artist MusicBrainz did not identify. */
const LOCAL_ID_PREFIX = "local-";

/** The MusicBrainz ID, or undefined for none, a blank one or a saved band's `local-…` stand-in. */
export function realMusicBrainzId(id: string | null | undefined): string | undefined {
  const trimmed = id?.trim();
  return trimmed && !trimmed.startsWith(LOCAL_ID_PREFIX) ? trimmed : undefined;
}

/**
 * The key two spellings of one artist share: "The Cure", "cure" and
 * "Cure, The" all fold to "cure". Empty for an empty name.
 */
export function foldArtistName(name: string): string {
  return remembered(folded, name, fold);
}

/** Folding is pure and the search compares the same few hundred names many times over. */
const folded = new Map<string, string>();
const variantsOf = new Map<string, string[]>();
const MAX_REMEMBERED = 5000;

function remembered<T>(cache: Map<string, T>, key: string, compute: (key: string) => T): T {
  const known = cache.get(key);
  if (known !== undefined) return known;
  if (cache.size >= MAX_REMEMBERED) cache.clear();
  const value = compute(key);
  cache.set(key, value);
  return value;
}

function fold(name: string): string {
  const lower = name.trim().toLowerCase().normalize("NFKD").replace(FOLDED_MARKS, "").normalize("NFC");
  const withoutArticle = LEADING_ARTICLE.test(lower)
    ? lower.replace(LEADING_ARTICLE, "")
    : lower.replace(TRAILING_ARTICLE, "");
  const letters = withoutArticle.replace(/[^\p{L}\p{N}]/gu, "");
  // "!!!" is a name too.
  return letters || lower;
}

/** The folded name with each letter of its own also written plainly and transliterated. */
function spellingVariants(foldedName: string): string[] {
  return remembered(variantsOf, foldedName, expandLetters);
}

function expandLetters(foldedName: string): string[] {
  let variants = [""];
  for (const letter of foldedName) {
    const options = LETTER_VARIANTS[letter];
    const next = options ? [letter, ...options] : [letter];
    variants = variants.flatMap((v) => next.map((n) => v + n)).slice(0, MAX_VARIANTS);
  }
  return variants;
}

function foldedNames(ref: ArtistRef): string[] {
  return [ref.name, ref.canonicalName ?? ""].map(foldArtistName).filter(Boolean);
}

function overlap(a: Iterable<string>, b: Iterable<string>): boolean {
  const set = new Set(a);
  for (const x of b) if (set.has(x)) return true;
  return false;
}

export function compareArtists(a: ArtistRef, b: ArtistRef): ArtistMatch {
  const idA = realMusicBrainzId(a.mbid);
  const idB = realMusicBrainzId(b.mbid);
  if (idA && idB) return idA === idB ? "same" : "different";

  const namesA = foldedNames(a);
  const namesB = foldedNames(b);
  if (overlap(namesA, namesB)) return idA || idB ? "possibly" : "same";
  if (overlap(namesA.flatMap(spellingVariants), namesB.flatMap(spellingVariants))) return "possibly";
  return "different";
}

/** Certainly the same artist: what verification and saved bands accept without asking. */
export function isSameArtist(a: ArtistRef, b: ArtistRef): boolean {
  return compareArtists(a, b) === "same";
}

/** The same artist or possibly so: what the search and the eval treat as one artist. */
export function mayBeSameArtist(a: ArtistRef, b: ArtistRef): boolean {
  return compareArtists(a, b) !== "different";
}

/**
 * The artist in the list that a mention refers to: the same artist if one is
 * there, else one spelled the same (an ID on one side only), else a possible
 * match. Undefined when none may be the same artist.
 */
export function findArtist<T extends ArtistRef>(ref: ArtistRef, artists: readonly T[]): T | undefined {
  const verdicts = artists.map((artist) => compareArtists(ref, artist));
  const names = foldedNames(ref);
  return artists.find((_, i) => verdicts[i] === "same")
    ?? artists.find((artist, i) => verdicts[i] === "possibly" && overlap(names, foldedNames(artist)))
    ?? artists.find((_, i) => verdicts[i] === "possibly");
}
