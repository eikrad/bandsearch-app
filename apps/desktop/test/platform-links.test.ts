import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformLinks } from "../src/platformLinks.js";

test("buildPlatformLinks returns Bandcamp, SoundCloud, Spotify search links for any artist", () => {
  const links = buildPlatformLinks("Wolves in the Throne Room");
  assert.equal(links.length, 3);

  const bandcamp = links.find((l) => l.platform === "bandcamp");
  const soundcloud = links.find((l) => l.platform === "soundcloud");
  const spotify = links.find((l) => l.platform === "spotify");

  assert.ok(bandcamp, "has bandcamp link");
  assert.ok(soundcloud, "has soundcloud link");
  assert.ok(spotify, "has spotify link");

  assert.equal(bandcamp.url.includes("bandcamp.com"), true);
  assert.equal(soundcloud.url.includes("soundcloud.com"), true);
  assert.equal(spotify.url.includes("spotify.com"), true);

  assert.equal(bandcamp.url.includes("Wolves"), true);
});

test("buildPlatformLinks URL-encodes artist names with special characters", () => {
  const links = buildPlatformLinks("Fen & Friends");
  const bandcamp = links.find((l) => l.platform === "bandcamp");
  assert.ok(bandcamp, "has bandcamp link");
  assert.equal(bandcamp.url.includes("Fen"), true);
  assert.equal(bandcamp.url.includes(" "), false, "no raw spaces in URL");
});

test("buildPlatformLinks returns empty array for empty name", () => {
  const links = buildPlatformLinks("");
  assert.equal(links.length, 0);
});
