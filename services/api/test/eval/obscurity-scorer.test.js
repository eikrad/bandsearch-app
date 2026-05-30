const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyObscurityTier, OBSCURITY_THRESHOLDS } = require("../../src/eval/obscurityScorer");

test("classifyObscurityTier: >500k listeners is mainstream", () => {
  assert.equal(classifyObscurityTier(500001), "mainstream");
  assert.equal(classifyObscurityTier(2000000), "mainstream");
});

test("classifyObscurityTier: exactly 500k is cult (boundary)", () => {
  assert.equal(classifyObscurityTier(500000), "cult");
});

test("classifyObscurityTier: 20k-500k is cult", () => {
  assert.equal(classifyObscurityTier(20000), "cult");
  assert.equal(classifyObscurityTier(100000), "cult");
});

test("classifyObscurityTier: 2k-20k is underground", () => {
  assert.equal(classifyObscurityTier(2000), "underground");
  assert.equal(classifyObscurityTier(19999), "underground");
});

test("classifyObscurityTier: 0-2k is obscure", () => {
  assert.equal(classifyObscurityTier(0), "obscure");
  assert.equal(classifyObscurityTier(1999), "obscure");
});

test("classifyObscurityTier: null listeners is unknown", () => {
  assert.equal(classifyObscurityTier(null), "unknown");
  assert.equal(classifyObscurityTier(undefined), "unknown");
});

test("classifyObscurityTier: negative listeners is unknown", () => {
  assert.equal(classifyObscurityTier(-5), "unknown");
});

test("OBSCURITY_THRESHOLDS exposes the documented cut points", () => {
  assert.equal(OBSCURITY_THRESHOLDS.mainstream, 500000);
  assert.equal(OBSCURITY_THRESHOLDS.cult, 20000);
  assert.equal(OBSCURITY_THRESHOLDS.underground, 2000);
});
