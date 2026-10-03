import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const releasePath = resolve(
  __dirname,
  "../../../.github/workflows/release.yml",
);

test("release workflow file exists", () => {
  assert.ok(existsSync(releasePath), "Expected .github/workflows/release.yml");
});

const releaseYml = existsSync(releasePath)
  ? readFileSync(releasePath, "utf8")
  : "";

const releasePleasePath = resolve(
  __dirname,
  "../../../.github/workflows/release-please.yml",
);
const releasePleaseYml = existsSync(releasePleasePath)
  ? readFileSync(releasePleasePath, "utf8")
  : "";

test("release builds start from release-please or by hand, not from a tag push", () => {
  assert.ok(
    /workflow_call:/.test(releaseYml),
    "Expected a workflow_call trigger",
  );
  assert.ok(
    /workflow_dispatch:/.test(releaseYml),
    "Expected a workflow_dispatch trigger for test builds",
  );
  assert.ok(
    !/^\s*push:/m.test(releaseYml),
    "A tag push must not build: release-please's own tag would start a second build",
  );
  assert.ok(
    releasePleaseYml.includes("uses: ./.github/workflows/release.yml"),
    "Expected release-please.yml to call release.yml",
  );
});

test("release workflow matrix covers linux, windows, and macos", () => {
  assert.ok(releaseYml.includes("ubuntu-latest"), "Expected ubuntu-latest");
  assert.ok(releaseYml.includes("windows-latest"), "Expected windows-latest");
  assert.ok(releaseYml.includes("macos-latest"), "Expected macos-latest");
});

test("release workflow downloads Node sidecars for each platform", () => {
  assert.ok(
    releaseYml.includes("node-x86_64-unknown-linux-gnu"),
    "Expected Linux sidecar name",
  );
  assert.ok(
    releaseYml.includes("node-x86_64-pc-windows-msvc.exe"),
    "Expected Windows sidecar name",
  );
  assert.ok(
    releaseYml.includes("node-aarch64-apple-darwin"),
    "Expected macOS ARM sidecar name",
  );
});

test("release workflow uses tauri-action with desktop projectPath", () => {
  assert.ok(
    releaseYml.includes("tauri-apps/tauri-action"),
    "Expected tauri-apps/tauri-action",
  );
  assert.ok(
    /projectPath:\s*apps\/desktop/.test(releaseYml),
    "Expected projectPath: apps/desktop",
  );
});

test("desktop package.json exposes tauri script for tauri-action", () => {
  const pkg = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../apps/desktop/package.json"),
      "utf8",
    ),
  );
  assert.equal(
    pkg.scripts?.tauri,
    "tauri",
    'Expected apps/desktop package.json scripts.tauri = "tauri"',
  );
});

test("release workflow signs updater artifacts via secrets", () => {
  assert.ok(
    releaseYml.includes("TAURI_SIGNING_PRIVATE_KEY"),
    "Expected TAURI_SIGNING_PRIVATE_KEY",
  );
  assert.ok(
    releaseYml.includes("TAURI_SIGNING_PRIVATE_KEY_PASSWORD"),
    "Expected TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  );
});

test("release builds go into a draft that is published only after every build", () => {
  assert.ok(
    /releaseDraft:\s*true/.test(releaseYml),
    "Expected releaseDraft: true",
  );
  assert.ok(
    /releaseId:\s*\$\{\{\s*inputs\.release_id/.test(releaseYml),
    "Expected uploads into the draft release-please created (releaseId)",
  );
  assert.ok(
    /needs:\s*\[release-please, build\]/.test(releasePleaseYml) &&
      releasePleaseYml.includes("--draft=false") &&
      releasePleaseYml.includes("--latest"),
    "Expected a publish job that needs the builds and marks the release latest",
  );
});

test("manual test builds create a draft prerelease", () => {
  assert.ok(
    /prerelease:\s*\$\{\{\s*!inputs\.release_id\s*\}\}/.test(releaseYml),
    "Expected prerelease when no release_id is given",
  );
});
