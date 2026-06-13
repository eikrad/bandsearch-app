const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function hostTriple() {
  const output = execSync("rustc -vV", { encoding: "utf8" });
  const match = output.match(/^host:\s+(\S+)/m);
  assert.ok(match, "could not determine host triple from rustc -vV");
  return match[1];
}

test("tauri.conf.json externalBin entries all have a matching binary file", () => {
  const confPath = path.join(root, "src-tauri/tauri.conf.json");
  const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));

  const bins = conf?.bundle?.externalBin ?? [];
  if (bins.length === 0) return;

  const triple = hostTriple();

  for (const bin of bins) {
    const name = path.basename(bin);
    const expected = path.join(root, "src-tauri/binaries", `${name}-${triple}`);
    assert.ok(
      fs.existsSync(expected),
      `externalBin '${bin}' requires ${expected} — run: ln -sf $(which node) ${expected}`
    );
  }
});
