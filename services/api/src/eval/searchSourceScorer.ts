export const DISCOVERY_DOMAINS = [
  "bandcamp.com",
  "rateyourmusic.com",
  "rym.xyz",
  "reddit.com",
  "metal-archives.com",
  "sputnikmusic.com",
  "last.fm",
  "lastfm.com",
];

/**
 * Returns the fraction of URLs (0–1) that belong to recognised discovery domains.
 * Returns 0 for an empty list.
 */
export function scoreSearchSources(urls: string[]): number {
  if (urls.length === 0) return 0;
  const hits = urls.filter((url) =>
    DISCOVERY_DOMAINS.some((domain) => url.includes(domain)),
  ).length;
  return hits / urls.length;
}

export type SourceQuality = "high" | "medium" | "low";

export function ratioToSourceQuality(ratio: number): SourceQuality {
  if (ratio >= 0.6) return "high";
  if (ratio >= 0.3) return "medium";
  return "low";
}
