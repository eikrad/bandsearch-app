import test from "node:test";
import assert from "node:assert/strict";
import { assertBandRepository, assertBandGroupRepository, assertPreferenceRepository } from "../src/preferences/preferenceRepository.js";
import { createInMemoryPreferenceRepository } from "../src/preferences/preferenceMemory.js";

const noop = async () => {};

// These tests prove the runtime guards catch an incomplete repository, so they
// need a stub with one method removed — something the static types forbid.
function without<T extends Record<string, unknown>>(stub: T, method: keyof T & string): unknown {
  const copy: Record<string, unknown> = { ...stub };
  delete copy[method];
  return copy;
}

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
  const repo = without(bandRepositoryStub(), "addSavedBand");
  assert.throws(() => assertBandRepository(repo), /missing method addSavedBand/);
});

test("assertBandRepository throws when buildContext is missing", () => {
  const repo = without(bandRepositoryStub(), "buildContext");
  assert.throws(() => assertBandRepository(repo), /missing method buildContext/);
});

test("assertBandGroupRepository accepts an object with all 7 BandGroupRepository methods", () => {
  const resolved = assertBandGroupRepository(bandGroupRepositoryStub());
  assert.equal(typeof resolved.listGroups, "function");
});

test("assertBandGroupRepository throws when listGroups is missing", () => {
  const repo = without(bandGroupRepositoryStub(), "listGroups");
  assert.throws(() => assertBandGroupRepository(repo), /missing method listGroups/);
});

test("assertBandGroupRepository throws when importSavedBands is missing", () => {
  const repo = without(bandGroupRepositoryStub(), "importSavedBands");
  assert.throws(() => assertBandGroupRepository(repo), /missing method importSavedBands/);
});

test("assertPreferenceRepository still accepts a full 13-method object", () => {
  const repo = { ...bandRepositoryStub(), ...bandGroupRepositoryStub() };
  const resolved = assertPreferenceRepository(repo);
  assert.equal(typeof resolved.addSavedBand, "function");
  assert.equal(typeof resolved.listGroups, "function");
});

test("assertPreferenceRepository throws when any method is missing", () => {
  const repo = without({ ...bandRepositoryStub(), ...bandGroupRepositoryStub() }, "removeArtistFromGroup");
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
