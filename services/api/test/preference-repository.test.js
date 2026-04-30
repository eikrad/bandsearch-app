const test = require("node:test");
const assert = require("node:assert/strict");

const { assertPreferenceRepository } = require("../src/preferences/preferenceRepository");
const { createInMemoryPreferenceRepository } = require("../src/preferences/preferenceMemory");

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
