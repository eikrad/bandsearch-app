import test from "node:test";
import assert from "node:assert/strict";
import { assertPreferenceRepository } from "../src/preferences/preferenceRepository.js";
import { createInMemoryPreferenceRepository } from "../src/preferences/preferenceMemory.js";

test("assertPreferenceRepository accepts valid repository", () => {
  const repository = createInMemoryPreferenceRepository();
  const resolved = assertPreferenceRepository(repository);
  assert.equal(typeof resolved.addSavedBand, "function");
});

test("assertPreferenceRepository rejects missing methods", () => {
  assert.throws(
    () => assertPreferenceRepository({ buildContext: () => "" }),
    /missing method addSavedBand/,
  );
});

test("assertPreferenceRepository requires buildContextForIds", () => {
  assert.throws(
    () =>
      assertPreferenceRepository({
        addSavedBand: async () => {},
        listSavedBands: async () => [],
        updateSavedBand: async () => {},
        deleteSavedBand: async () => {},
        buildContext: async () => "",
      }),
    /missing method buildContextForIds/,
  );
});
