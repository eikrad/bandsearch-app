// server.ts lives at services/api/src/ — workspace root is three levels up.
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

dotenvConfig({ path: resolve(__dirname, "../../../.env") });

import { createApp } from "./app.js";
import { validateRuntimeEnv } from "./config/env.js";
import { createPreferenceRepository, splitPreferenceRepository } from "./preferences/preferenceRepository.js";
import { createRecommendationPipeline } from "./recommendationPipeline.js";

async function start() {
  const runtimeConfig = validateRuntimeEnv();
  const preferenceRepository = createPreferenceRepository(runtimeConfig);

  const recommendationPipeline = createRecommendationPipeline({
    runtimeConfig,
    // The pipeline only reads saved bands to build prompt context; it has no
    // business with groups, so it is handed the band half explicitly.
    preferenceRepository: splitPreferenceRepository(preferenceRepository).bands,
  });

  await Promise.race([
    recommendationPipeline.whenReady(),
    new Promise((resolve) => setTimeout(resolve, runtimeConfig.pipelineReadyTimeoutMs)),
  ]);

  const app = createApp({ runtimeConfig, preferenceRepository, recommendationPipeline });
  app.listen(runtimeConfig.port, () => {
    console.log(JSON.stringify({ level: "info", message: "Bandsearch API listening", port: runtimeConfig.port }));
  });
}

start().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(JSON.stringify({ level: "error", message: "server failed to start", error: message }));
  process.exit(1);
});
