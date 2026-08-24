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
    () => assertPreferenceRepository({ listSavedBands: async () => [] }),
    /missing method addSavedBand/,
  );
});

test("assertPreferenceRepository requires the group methods too", () => {
  assert.throws(
    () =>
      assertPreferenceRepository({
        addSavedBand: async () => {},
        listSavedBands: async () => [],
        updateSavedBand: async () => {},
        deleteSavedBand: async () => {},
      }),
    /missing method importSavedBands/,
  );
});
