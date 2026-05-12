const test = require("node:test");
const assert = require("node:assert/strict");

const {
  sanitizeMusicBrainzQueryCandidate,
  tryParseMusicBrainzQueryFromModelText,
  MUSICBRAINZ_PLANNED_QUERY_MAX_LENGTH,
  createMusicBrainzQueryPlanner,
} = require("../src/agent/musicBrainzQueryPlanner");

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
