interface PlatformDef {
  platform: string;
  label: string;
  buildUrl: (name: string) => string;
}

export interface PlatformLink {
  platform: string;
  label: string;
  url: string;
}

const PLATFORMS: PlatformDef[] = [
  {
    platform: "bandcamp",
    label: "Bandcamp",
    buildUrl: (name) => `https://bandcamp.com/search?q=${encodeURIComponent(name)}`,
  },
  {
    platform: "soundcloud",
    label: "SoundCloud",
    buildUrl: (name) => `https://soundcloud.com/search?q=${encodeURIComponent(name)}`,
  },
  {
    platform: "spotify",
    label: "Spotify",
    buildUrl: (name) => `https://open.spotify.com/search/${encodeURIComponent(name)}`,
  },
];

export function buildPlatformLinks(artistName: string): PlatformLink[] {
  if (!artistName) return [];
  return PLATFORMS.map(({ platform, label, buildUrl }) => ({
    platform,
    label,
    url: buildUrl(artistName),
  }));
}
