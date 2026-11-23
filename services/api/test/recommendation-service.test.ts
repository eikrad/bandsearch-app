import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveRecommendationFacadeInput } from "../src/recommendations.js";
import type { SavedBandForContext } from "../src/savedBandContext.js";

function savedBand(overrides: Partial<SavedBandForContext> = {}): SavedBandForContext {
  return { id: "b1", name: "Alcest", rating: 5, categories: [], note: "", noteEdited: false, ...overrides };
}

test("resolveRecommendationFacadeInput fresh mode does not call repository", async () => {
  let buildCalled = false;
  const preferenceRepository = {
    async listSavedBands() {
      buildCalled = true;
      return [savedBand({ name: "Alcest" })];
    },
  };

  const result = await resolveRecommendationFacadeInput({ mode: "fresh", priorityContext: "  prio  " }, preferenceRepository);

  assert.equal(result.mode, "fresh");
  assert.equal(result.preferenceContext, "prio");
  assert.deepEqual(result.messages, []);
  assert.equal(buildCalled, false);
});

test("resolveRecommendationFacadeInput preference-aware merges priority with the saved band context", async () => {
  const preferenceRepository = {
    async listSavedBands() {
      return [savedBand({ name: "Alcest" })];
    },
  };

  const result = await resolveRecommendationFacadeInput(
    { mode: "preference-aware", priorityContext: "note" },
    preferenceRepository,
  );

  assert.equal(result.mode, "preference-aware");
  assert.equal(result.preferenceContext, "note\nAlcest (rating 5/5) tags: ");
});

test("resolveRecommendationFacadeInput preference-aware narrows the context to the selected ids", async () => {
  const preferenceRepository = {
    async listSavedBands() {
      return [savedBand({ id: "mb-1", name: "Alcest" }), savedBand({ id: "other", name: "Fen" })];
    },
  };

  const result = await resolveRecommendationFacadeInput(
    { mode: "preference-aware", selectedArtistIds: ["mb-1", "mb-2"] },
    preferenceRepository,
  );

  assert.match(result.preferenceContext, /Alcest/);
  assert.doesNotMatch(result.preferenceContext, /Fen/, "unselected bands must stay out of the context");
});
