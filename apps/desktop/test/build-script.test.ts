import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

test("build script produces dist/bundle.js and dist/index.html", () => {
  execSync("npx tsx scripts/build.ts", { cwd: root, stdio: "pipe" });

  assert.ok(
    fs.existsSync(path.join(root, "dist/bundle.js")),
    "dist/bundle.js must exist after build",
  );
  assert.ok(
    fs.existsSync(path.join(root, "dist/index.html")),
    "dist/index.html must exist after build",
  );
});
