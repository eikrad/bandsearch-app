const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", nbsp: " " };

/** The text of an HTML fragment, on one line: Brave's descriptions and Last.fm's biographies are such fragments. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&([a-z]+|#\w+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

/** At most `max` characters of the text around a word, cut at whole words. */
export function wordsAround(text: string, at: number, length: number, max: number): string {
  if (text.length <= max) return text;
  const start = Math.max(0, Math.min(at - Math.floor((max - length) / 2), text.length - max));
  const end = start + max;
  const words = text.slice(start, end);
  // Cut back to whole words at either end that is not the text's own.
  const from = start > 0 ? words.indexOf(" ") + 1 : 0;
  const to = end < text.length ? words.lastIndexOf(" ") : words.length;
  return `${start > 0 ? "…" : ""}${words.slice(from, to)}${end < text.length ? "…" : ""}`;
}
