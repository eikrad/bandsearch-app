const test = require("node:test");
const assert = require("node:assert/strict");
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("build script produces dist/bundle.js and dist/index.html", () => {
  execSync("node scripts/build.js", { cwd: root, stdio: "pipe" });

  assert.ok(
    fs.existsSync(path.join(root, "dist/bundle.js")),
    "dist/bundle.js must exist after build"
  );
  assert.ok(
    fs.existsSync(path.join(root, "dist/index.html")),
    "dist/index.html must exist after build"
  );
});
