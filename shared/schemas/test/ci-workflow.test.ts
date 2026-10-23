import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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

test("every workflow sets up the Node version production runs (.nvmrc)", () => {
  const workflowsDir = resolve(__dirname, "../../../.github/workflows");
  for (const file of readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f))) {
    const yml = readFileSync(resolve(workflowsDir, file), "utf8");
    if (!yml.includes("actions/setup-node")) continue;
    assert.ok(
      !/node-version:/.test(yml) && /node-version-file:\s*\.nvmrc/.test(yml),
      `${file}: Expected setup-node with node-version-file: .nvmrc`,
    );
  }
});
