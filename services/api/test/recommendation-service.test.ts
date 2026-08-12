import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveRecommendationFacadeInput,
  enrichRecommendationsWithMbIds,
} from "../src/recommendations.js";

test("enrichRecommendationsWithMbIds attaches MusicBrainz id when names match", () => {
  const items = [{ artist: "Fen", why: "x", sourceSignals: ["a"] }];
  const artists = [{ id: "mbid-fen", name: "Fen", score: 99, disambiguation: "" }];
  const out = enrichRecommendationsWithMbIds(items, artists);
  const first = out[0];
  assert.ok(first && typeof first === "object");
  assert.equal((first as Record<string, unknown>).musicbrainzArtistId, "mbid-fen");
});

test("resolveRecommendationFacadeInput fresh mode does not call repository", async () => {
  let buildCalled = false;
  const preferenceRepository = {
    async buildContext() {
      buildCalled = true;
      return "repo";
    },
    async buildContextForIds() {
      return "";
    },
  };

  const result = await resolveRecommendationFacadeInput({ mode: "fresh", priorityContext: "  prio  " }, preferenceRepository);

  assert.equal(result.mode, "fresh");
  assert.equal(result.preferenceContext, "prio");
  assert.deepEqual(result.messages, []);
  assert.equal(buildCalled, false);
});

test("resolveRecommendationFacadeInput preference-aware merges priority and buildContext", async () => {
  const preferenceRepository = {
    async buildContext() {
      return "saved context";
    },
    async buildContextForIds() {
      return "";
    },
  };

  const result = await resolveRecommendationFacadeInput(
    { mode: "preference-aware", priorityContext: "note" },
    preferenceRepository,
  );

  assert.equal(result.mode, "preference-aware");
  assert.equal(result.preferenceContext, "note\nsaved context");
});

test("resolveRecommendationFacadeInput preference-aware uses buildContextForIds when ids provided", async () => {
  const preferenceRepository = {
    async buildContext() {
      return "full";
    },
    async buildContextForIds(ids: string[]) {
      return `ids:${ids.join(",")}`;
    },
  };

  const result = await resolveRecommendationFacadeInput(
    { mode: "preference-aware", selectedArtistIds: ["mb-1", "mb-2"] },
    preferenceRepository,
  );

  assert.ok(result.preferenceContext.includes("ids:mb-1,mb-2"));
});
