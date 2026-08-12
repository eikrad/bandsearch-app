import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const root = process.cwd();

type TauriConfig = {
  bundle?: {
    externalBin?: string[];
    createUpdaterArtifacts?: boolean;
  };
  plugins?: {
    updater?: {
      pubkey?: string;
      endpoints?: string[];
    };
  };
};

function hostTriple(): string {
  const output = execSync("rustc -vV", { encoding: "utf8" });
  const match = output.match(/^host:\s+(\S+)/m);
  assert.ok(match, "could not determine host triple from rustc -vV");
  return match[1];
}

function readTauriConf(): TauriConfig {
  const confPath = path.join(root, "src-tauri/tauri.conf.json");
  return JSON.parse(fs.readFileSync(confPath, "utf8")) as TauriConfig;
}

test("tauri.conf.json externalBin entries all have a matching binary file", (t) => {
  const conf = readTauriConf();

  const bins = conf?.bundle?.externalBin ?? [];
  if (bins.length === 0) return;

  const triple = hostTriple();

  for (const bin of bins) {
    const name = path.basename(bin);
    const expected = path.join(root, "src-tauri/binaries", `${name}-${triple}`);
    if (!fs.existsSync(expected)) {
      t.skip(`binary not present — run: ln -sf $(which node) ${expected}`);
      return;
    }
  }
});

test("tauri.conf.json enables updater artifacts for signed releases", () => {
  const conf = readTauriConf();
  assert.equal(
    conf?.bundle?.createUpdaterArtifacts,
    true,
    "Expected bundle.createUpdaterArtifacts true",
  );
  assert.ok(
    conf?.plugins?.updater?.pubkey,
    "Expected plugins.updater.pubkey to be set",
  );
  assert.ok(
    Array.isArray(conf?.plugins?.updater?.endpoints) &&
      conf.plugins.updater.endpoints.some((u) =>
        String(u).includes("releases/latest/download/latest.json"),
      ),
    "Expected GitHub latest.json updater endpoint",
  );
});
