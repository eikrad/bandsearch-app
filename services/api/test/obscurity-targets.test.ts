import test from "node:test";
import assert from "node:assert/strict";
import { OBSCURITY_TARGET_RANGES, obscurityTargetFit } from "../src/obscurityTargets.js";

// The ranges decided in #325 (2026-11-19), matched to the judge-calibration labels.
test("each obscurity target covers the decided Last.fm listener range", () => {
  assert.deepEqual(OBSCURITY_TARGET_RANGES, {
    cult: { min: 20_000, max: 500_000 },
    underground: { min: 2_000, max: 50_000 },
    obscure: { min: 0, max: 5_000 },
  });
});

test("a band inside the range fits its target, both ends included", () => {
  assert.equal(obscurityTargetFit(20_000, "cult"), "inRange");
  assert.equal(obscurityTargetFit(500_000, "cult"), "inRange");
  assert.equal(obscurityTargetFit(2_000, "underground"), "inRange");
  assert.equal(obscurityTargetFit(50_000, "underground"), "inRange");
  assert.equal(obscurityTargetFit(0, "obscure"), "inRange");
  assert.equal(obscurityTargetFit(5_000, "obscure"), "inRange");
});

test("a band with too few listeners is too obscure for Cult Following and Underground", () => {
  assert.equal(obscurityTargetFit(3_697, "cult"), "tooObscure");
  assert.equal(obscurityTargetFit(1_640, "underground"), "tooObscure");
});

test("a band with too many listeners is too mainstream for its target", () => {
  assert.equal(obscurityTargetFit(500_001, "cult"), "tooMainstream");
  assert.equal(obscurityTargetFit(80_000, "underground"), "tooMainstream");
  assert.equal(obscurityTargetFit(8_000, "obscure"), "tooMainstream");
});

test("the ranges overlap: 30k listeners fits both Cult Following and Underground", () => {
  assert.equal(obscurityTargetFit(30_000, "cult"), "inRange");
  assert.equal(obscurityTargetFit(30_000, "underground"), "inRange");
});

test("a band without a usable listener count has an unknown fit", () => {
  assert.equal(obscurityTargetFit(null, "cult"), "unknown");
  assert.equal(obscurityTargetFit(undefined, "underground"), "unknown");
  assert.equal(obscurityTargetFit(-1, "obscure"), "unknown");
  assert.equal(obscurityTargetFit(Number.NaN, "obscure"), "unknown");
});

test("without a recognised target there is no fit to judge", () => {
  assert.equal(obscurityTargetFit(3_000, undefined), null);
  assert.equal(obscurityTargetFit(3_000, null), null);
  assert.equal(obscurityTargetFit(3_000, "mainstream"), null);
});
