import test from "node:test";
import assert from "node:assert/strict";
import { buildSavedBandContext } from "../src/savedBandContext.js";
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
