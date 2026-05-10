const PLATFORMS = [
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

function buildPlatformLinks(artistName) {
  if (!artistName) return [];
  return PLATFORMS.map(({ platform, label, buildUrl }) => ({
    platform,
    label,
    url: buildUrl(artistName),
  }));
}

module.exports = { buildPlatformLinks };
