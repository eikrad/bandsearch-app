const test = require("node:test");
const assert = require("node:assert/strict");

const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const {
  sanitizeMusicBrainzQueryCandidate,
  tryParseMusicBrainzQueryFromModelText,
  MUSICBRAINZ_PLANNED_QUERY_MAX_LENGTH,
  createMusicBrainzQueryPlanner,
  getMusicBrainzArtistSearchReference,
} = require("../src/agent/musicBrainzQueryPlanner");
const {
  EMBEDDED_MUSICBRAINZ_ARTIST_SEARCH_REFERENCE,
} = require("../src/agent/prompts/musicBrainzArtistSearchReference.embedded");

test("embedded MB artist prompt matches musicbrainz-artist-search.md (edit both or update embedded)", () => {
  const candidates = [
    join(process.cwd(), "src", "agent", "prompts", "musicbrainz-artist-search.md"),
    join(process.cwd(), "services", "api", "src", "agent", "prompts", "musicbrainz-artist-search.md"),
  ];
  const path = candidates.find((p) => existsSync(p));
  assert.ok(path, "musicbrainz-artist-search.md should exist in repo");
  const file = readFileSync(path, "utf8").trim();
  assert.equal(EMBEDDED_MUSICBRAINZ_ARTIST_SEARCH_REFERENCE, file);
});

test("getMusicBrainzArtistSearchReference loads curated MusicBrainz artist prompt", () => {
  const ref = getMusicBrainzArtistSearchReference();
  assert.match(ref, /\/ws\/2\/artist/i);
  assert.match(ref, /Lucene/i);
});

test("sanitizeMusicBrainzQueryCandidate accepts short single-line string", () => {
  assert.equal(sanitizeMusicBrainzQueryCandidate("  Alcest  "), "Alcest");
});

test("sanitizeMusicBrainzQueryCandidate rejects newlines", () => {
  assert.equal(sanitizeMusicBrainzQueryCandidate("a\nb"), null);
});

test("sanitizeMusicBrainzQueryCandidate rejects overlong strings", () => {
  const long = "x".repeat(MUSICBRAINZ_PLANNED_QUERY_MAX_LENGTH + 1);
  assert.equal(sanitizeMusicBrainzQueryCandidate(long), null);
});

test("tryParseMusicBrainzQueryFromModelText reads JSON object", () => {
  const raw = '{"musicBrainzQuery":"Fen atmospheric"}';
  assert.equal(tryParseMusicBrainzQueryFromModelText(raw), "Fen atmospheric");
});

test("tryParseMusicBrainzQueryFromModelText strips markdown fences", () => {
  const raw = '```json\n{"musicBrainzQuery":"Deafheaven"}\n```';
  assert.equal(tryParseMusicBrainzQueryFromModelText(raw), "Deafheaven");
});

test("tryParseMusicBrainzQueryFromModelText returns null for wrong shape", () => {
  assert.equal(tryParseMusicBrainzQueryFromModelText('{"reply":"x"}'), null);
});

test("createMusicBrainzQueryPlanner rejects empty apiKey", async () => {
  await assert.rejects(() => createMusicBrainzQueryPlanner({ apiKey: "   " }), /apiKey is required/);
});
