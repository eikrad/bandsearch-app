import test from "node:test";
import assert from "node:assert/strict";
import { buildSavedBandContext, formatSavedBandContextLine } from "../src/savedBandContext.js";
import type { SavedBandContextSource } from "../src/savedBandContext.js";
import { createInMemoryPreferenceRepository } from "../src/preferences/preferenceMemory.js";

type Band = Awaited<ReturnType<SavedBandContextSource["listSavedBands"]>>[number];

function band(overrides: Partial<Band> = {}): Band {
  return {
    id: "b1",
    name: "Codeine",
    rating: 5,
    categories: ["slowcore"],
    note: "sparse",
    ...overrides,
  } as Band;
}

function source(bands: Band[], seen: Array<string | undefined> = []): SavedBandContextSource {
  return {
    listSavedBands: async (userId?: string) => {
      seen.push(userId);
      return bands;
    },
  };
}

test("an unrated band is described as unrated, not as a zero", () => {
  // A band the user saved but has not judged. "rating 0/5" or "rating null/5"
  // would both be lies the model would happily act on — 0 reads as a strong
  // negative it never expressed.
  const line = formatSavedBandContextLine(band({ rating: null }));

  assert.match(line, /not yet rated/);
  assert.doesNotMatch(line, /rating (0|null|undefined)/);
});

test("a rated band still states its rating", () => {
  assert.match(formatSavedBandContextLine(band({ rating: 4 })), /rating 4\/5/);
});

test("an unrated band still carries its tags and note", () => {
  // Saving is itself a signal; dropping the rest would throw away why the user
  // kept the artist at all.
  const line = formatSavedBandContextLine(band({ rating: null, categories: ["slowcore"], note: "sparse" }));

  assert.match(line, /slowcore/);
  assert.match(line, /sparse/);
});

test("buildSavedBandContext formats every saved band on its own line", async () => {
  const context = await buildSavedBandContext(
    source([band(), band({ id: "b2", name: "Bedhead", rating: 4, categories: [], note: "" })]),
  );

  assert.equal(
    context,
    "Codeine (rating 5/5) tags: slowcore note: sparse\nBedhead (rating 4/5) tags:  note: ",
  );
});

test("buildSavedBandContext returns an empty string when nothing is saved", async () => {
  assert.equal(await buildSavedBandContext(source([])), "");
});

test("buildSavedBandContext restricts the context to the requested ids", async () => {
  const context = await buildSavedBandContext(
    source([band(), band({ id: "b2", name: "Bedhead" })]),
    { ids: ["b2"] },
  );

  assert.match(context, /Bedhead/);
  assert.doesNotMatch(context, /Codeine/);
});

test("buildSavedBandContext returns an empty string for an empty id list", async () => {
  // An empty selection is not "no filter" — it is a filter that matches nothing.
  const context = await buildSavedBandContext(source([band()]), { ids: [] });
  assert.equal(context, "");
});

test("buildSavedBandContext returns an empty string when no id matches", async () => {
  assert.equal(await buildSavedBandContext(source([band()]), { ids: ["nope"] }), "");
});

test("buildSavedBandContext scopes the read to the given user", async () => {
  const seen: Array<string | undefined> = [];
  await buildSavedBandContext(source([band()], seen), { userId: "user-7" });
  assert.deepEqual(seen, ["user-7"]);
});

test("buildSavedBandContext scopes an id-filtered read to the given user too", async () => {
  const seen: Array<string | undefined> = [];
  await buildSavedBandContext(source([band()], seen), { ids: ["b1"], userId: "user-7" });
  assert.deepEqual(seen, ["user-7"]);
});

// The adapters no longer build context themselves, so the one remaining
// implementation has to work against a real one.
test("buildSavedBandContext works against a real repository", async () => {
  const repository = createInMemoryPreferenceRepository();
  await repository.addSavedBand(
    { musicbrainzArtistId: "mb-1", name: "Codeine", rating: 5, categories: ["slowcore"], note: "sparse" },
    "user-7",
  );

  const context = await buildSavedBandContext(repository, { userId: "user-7" });
  assert.match(context, /Codeine \(rating 5\/5\) tags: slowcore note: sparse/);

  const otherUser = await buildSavedBandContext(repository, { userId: "user-8" });
  assert.equal(otherUser, "", "context must not leak across users");
});
