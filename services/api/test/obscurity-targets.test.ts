import test from "node:test";
import assert from "node:assert/strict";
import { NEAR_MISS_FACTOR, OBSCURITY_TARGET_RANGES, fitObscurityTarget, isNearTarget } from "../src/obscurityTargets.js";

const fits = (listeners: Array<number | null | undefined>, target: string | null | undefined) =>
  fitObscurityTarget(listeners, target)?.map((f) => f.fit) ?? null;

// The ranges decided in #325 (2026-11-19), matched to the judge-calibration labels.
test("each obscurity target covers the decided Last.fm listener range", () => {
  assert.deepEqual(OBSCURITY_TARGET_RANGES, {
    cult: { min: 20_000, max: 500_000 },
    underground: { min: 2_000, max: 50_000 },
    obscure: { min: 0, max: 5_000 },
  });
});

test("a band inside the range fits its target, both ends included", () => {
  assert.deepEqual(fits([20_000, 500_000], "cult"), ["inRange", "inRange"]);
  assert.deepEqual(fits([2_000, 50_000], "underground"), ["inRange", "inRange"]);
  assert.deepEqual(fits([0, 5_000], "obscure"), ["inRange", "inRange"]);
});

test("a band with too few listeners is too obscure for Cult Following and Underground", () => {
  assert.deepEqual(fits([3_697], "cult"), ["tooObscure"]);
  assert.deepEqual(fits([1_640], "underground"), ["tooObscure"]);
});

test("a band with too many listeners is too mainstream for its target", () => {
  assert.deepEqual(fits([500_001], "cult"), ["tooMainstream"]);
  assert.deepEqual(fits([80_000], "underground"), ["tooMainstream"]);
  assert.deepEqual(fits([8_000], "obscure"), ["tooMainstream"]);
});

test("the ranges overlap: 30k listeners fits both Cult Following and Underground", () => {
  assert.deepEqual(fits([30_000], "cult"), ["inRange"]);
  assert.deepEqual(fits([30_000], "underground"), ["inRange"]);
});

test("a band Last.fm has no count for counts as obscure", () => {
  assert.deepEqual(fits([30_000, null, undefined, -1], "cult"), ["inRange", "tooObscure", "tooObscure", "tooObscure"]);
  assert.deepEqual(fits([30_000, null], "obscure"), ["tooMainstream", "inRange"]);
});

test("a nearer miss has a smaller distance, measured on a log scale", () => {
  const result = fitObscurityTarget([15_000, 900_000, 6_000, 300, 40_000], "cult")!;
  const [justObscure, bitMainstream, obscure, farObscure, inRange] = result.map((f) => f.miss);
  assert.equal(inRange, 0);
  assert.ok(justObscure < bitMainstream && bitMainstream < obscure && obscure < farObscure);
});

test("with no listener count for any band (Last.fm off) there is nothing to fit", () => {
  assert.equal(fitObscurityTarget([null, undefined], "cult"), null);
});

test("without a recognised target there is no fit to judge", () => {
  assert.equal(fitObscurityTarget([3_000], undefined), null);
  assert.equal(fitObscurityTarget([3_000], null), null);
  assert.equal(fitObscurityTarget([3_000], "mainstream"), null);
});

test("a miss up to ten times outside the range is near; further off is far", () => {
  const near = (listeners: number[]) => fitObscurityTarget(listeners, "underground")!.map(isNearTarget);
  assert.deepEqual(near([10_000, 200, 199, 500_000, 500_001]), [true, true, false, true, false]);
  assert.equal(NEAR_MISS_FACTOR, 10);
});
