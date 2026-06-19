const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertBandRepository,
  assertBandGroupRepository,
  assertPreferenceRepository,
} = require("../src/preferences/preferenceRepository");
const { createInMemoryPreferenceRepository } = require("../src/preferences/preferenceMemory");

const noop = async () => {};

function bandRepositoryStub() {
  return {
    addSavedBand: noop,
    listSavedBands: noop,
    updateSavedBand: noop,
    deleteSavedBand: noop,
    buildContext: noop,
    buildContextForIds: noop,
  };
}

function bandGroupRepositoryStub() {
  return {
    importSavedBands: noop,
    listGroups: noop,
    createGroup: noop,
    renameGroup: noop,
    deleteGroup: noop,
    addArtistToGroup: noop,
    removeArtistFromGroup: noop,
  };
}

test("assertBandRepository accepts an object with all 6 BandRepository methods", () => {
  const resolved = assertBandRepository(bandRepositoryStub());
  assert.equal(typeof resolved.addSavedBand, "function");
});

test("assertBandRepository throws when addSavedBand is missing", () => {
  const repo = bandRepositoryStub();
  delete repo.addSavedBand;
  assert.throws(() => assertBandRepository(repo), /missing method addSavedBand/);
});

test("assertBandRepository throws when buildContext is missing", () => {
  const repo = bandRepositoryStub();
  delete repo.buildContext;
  assert.throws(() => assertBandRepository(repo), /missing method buildContext/);
});

test("assertBandGroupRepository accepts an object with all 7 BandGroupRepository methods", () => {
  const resolved = assertBandGroupRepository(bandGroupRepositoryStub());
  assert.equal(typeof resolved.listGroups, "function");
});

test("assertBandGroupRepository throws when listGroups is missing", () => {
  const repo = bandGroupRepositoryStub();
  delete repo.listGroups;
  assert.throws(() => assertBandGroupRepository(repo), /missing method listGroups/);
});

test("assertBandGroupRepository throws when importSavedBands is missing", () => {
  const repo = bandGroupRepositoryStub();
  delete repo.importSavedBands;
  assert.throws(() => assertBandGroupRepository(repo), /missing method importSavedBands/);
});

test("assertPreferenceRepository still accepts a full 13-method object", () => {
  const repo = { ...bandRepositoryStub(), ...bandGroupRepositoryStub() };
  const resolved = assertPreferenceRepository(repo);
  assert.equal(typeof resolved.addSavedBand, "function");
  assert.equal(typeof resolved.listGroups, "function");
});

test("assertPreferenceRepository throws when any method is missing", () => {
  const repo = { ...bandRepositoryStub(), ...bandGroupRepositoryStub() };
  delete repo.removeArtistFromGroup;
  assert.throws(() => assertPreferenceRepository(repo), /missing method removeArtistFromGroup/);
});

test("the in-memory adapter satisfies assertBandRepository", () => {
  const resolved = assertBandRepository(createInMemoryPreferenceRepository());
  assert.equal(typeof resolved.buildContextForIds, "function");
});

test("the in-memory adapter satisfies assertBandGroupRepository", () => {
  const resolved = assertBandGroupRepository(createInMemoryPreferenceRepository());
  assert.equal(typeof resolved.createGroup, "function");
});
