import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ciYml = readFileSync(
  resolve(__dirname, "../../../.github/workflows/ci.yml"),
  "utf8",
);

test("CI workflow uses a matrix strategy", () => {
  assert.ok(ciYml.includes("matrix:"), "Expected matrix: strategy in CI workflow");
});

test("CI workflow includes ubuntu-latest runner", () => {
  assert.ok(ciYml.includes("ubuntu-latest"), "Expected ubuntu-latest in CI matrix");
});

test("CI workflow includes windows-latest runner", () => {
  assert.ok(ciYml.includes("windows-latest"), "Expected windows-latest in CI matrix");
});
