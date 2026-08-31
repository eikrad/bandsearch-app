import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(process.argv[1]), "../../..");

function readJsonVersion(relativePath: string): string {
  const filePath = path.join(root, relativePath);
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.ok(
    typeof parsed === "object" && parsed !== null && "version" in parsed,
    `${relativePath} must have a "version" field`,
  );
  const version = (parsed as { version: unknown }).version;
  assert.equal(typeof version, "string", `${relativePath} version must be a string`);
  return version as string;
}

function readCargoVersion(relativePath: string): string {
  const filePath = path.join(root, relativePath);
  const contents = fs.readFileSync(filePath, "utf8");
  const match = contents.match(/^version\s*=\s*"([^"]+)"/m);
  assert.ok(match, `${relativePath} must have a top-level version field`);
  return match![1];
}

test("the app version is the same string across npm, Cargo and Tauri", () => {
  const versions: Record<string, string> = {
    "package.json": readJsonVersion("package.json"),
    "apps/desktop/package.json": readJsonVersion("apps/desktop/package.json"),
    "services/api/package.json": readJsonVersion("services/api/package.json"),
    "services/eval/package.json": readJsonVersion("services/eval/package.json"),
    "shared/schemas/package.json": readJsonVersion("shared/schemas/package.json"),
    "apps/desktop/src-tauri/Cargo.toml": readCargoVersion("apps/desktop/src-tauri/Cargo.toml"),
    "apps/desktop/src-tauri/tauri.conf.json": readJsonVersion(
      "apps/desktop/src-tauri/tauri.conf.json",
    ),
  };

  const distinct = new Set(Object.values(versions));
  assert.equal(
    distinct.size,
    1,
    `Expected one version everywhere, found: ${JSON.stringify(versions, null, 2)}`,
  );
});
