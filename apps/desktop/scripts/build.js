const esbuild = require("esbuild");
const fs = require("node:fs");

const config = {
  entryPoints: ["src/browserEntry.js"],
  bundle: true,
  outfile: "dist/bundle.js",
  platform: "browser",
};

async function run() {
  const watch = process.argv.includes("--watch");
  fs.mkdirSync("dist", { recursive: true });
  fs.copyFileSync("public/index.html", "dist/index.html");
  fs.copyFileSync("public/styles.css", "dist/styles.css");

  if (watch) {
    const ctx = await esbuild.context({ ...config, sourcemap: true });
    await ctx.watch();
    console.log("watching for changes…");
  } else {
    await esbuild.build({ ...config, minify: true });
    console.log("build complete");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
