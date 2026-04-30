// server.js lives at services/api/src/ — workspace root is three levels up.
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });

const { createApp } = require("./app");
const { validateRuntimeEnv } = require("./config/env");
const { createMusicBrainzClient } = require("./integrations/musicbrainz");
const { createRecommendationAgent, createLangChainRunner } = require("./agent/recommendationAgent");
const { createRecommendationService } = require("./recommendations");

async function start() {
  const runtimeConfig = validateRuntimeEnv();

  let recommendationService;
  if (process.env.GEMINI_API_KEY) {
    try {
      const runModel = await createLangChainRunner({ timeoutMs: runtimeConfig.recommendationTimeoutMs });
      const musicBrainzClient = createMusicBrainzClient({
        timeoutMs: runtimeConfig.musicBrainzTimeoutMs,
        retries: runtimeConfig.musicBrainzRetries,
      });
      recommendationService = createRecommendationService({
        musicBrainzClient,
        recommendationAgent: createRecommendationAgent({ runModel }),
      });
    } catch (e) {
      console.error(JSON.stringify({ level: "warn", message: "Gemini init failed, using MusicBrainz fallback", error: e.message }));
    }
  }

  const app = createApp({ runtimeConfig, recommendationService });
  app.listen(runtimeConfig.port, () => {
    console.log(JSON.stringify({ level: "info", message: "Bandsearch API listening", port: runtimeConfig.port }));
  });
}

start().catch((e) => {
  console.error(JSON.stringify({ level: "error", message: "server failed to start", error: e.message }));
  process.exit(1);
});
