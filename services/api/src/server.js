// server.js lives at services/api/src/ — workspace root is three levels up.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });

const { createApp } = require("./app");
const { validateRuntimeEnv } = require("./config/env");
const { createPreferenceRepository } = require("./preferences/preferenceRepository");
const { createRecommendationPipeline } = require("./recommendationPipeline");

async function start() {
  const runtimeConfig = validateRuntimeEnv();
  const preferenceRepository = createPreferenceRepository(runtimeConfig);

  const recommendationPipeline = createRecommendationPipeline({
    runtimeConfig,
    preferenceRepository,
  });

  const app = createApp({ runtimeConfig, preferenceRepository, recommendationPipeline });
  app.listen(runtimeConfig.port, () => {
    console.log(JSON.stringify({ level: "info", message: "Bandsearch API listening", port: runtimeConfig.port }));
  });
}

start().catch((e) => {
  console.error(JSON.stringify({ level: "error", message: "server failed to start", error: e.message }));
  process.exit(1);
});
