import test from "node:test";
import assert from "node:assert/strict";
import { assertPreferenceRepository, createPreferenceRepository } from "../src/preferences/preferenceRepository.js";
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

// Defence in depth: createApp can be handed a runtime config directly, without
// going through validateRuntimeEnv, so the factory refuses the removed store too
// rather than quietly returning the SQLite default.
test("createPreferenceRepository refuses the removed postgres store", () => {
  assert.throws(
    () => createPreferenceRepository({ preferenceStore: "postgres" }),
    /PREFERENCE_STORE=postgres is no longer supported/,
  );
});

// The sync client has to be awaited, which this synchronous factory cannot do.
// Falling through to SQLite would silently give a different database, so it
// refuses and names the path that does work.
test("createPreferenceRepository refuses turso-sync and points at the async path", () => {
  assert.throws(
    () => createPreferenceRepository({ preferenceStore: "turso-sync" }),
    /createTursoSyncRepositories/,
  );
});
