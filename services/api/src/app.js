const express = require("express");
const {
  validateRecommendationRequest,
  createRecommendationService,
} = require("./recommendations");
const { createMusicBrainzClient } = require("./integrations/musicbrainz");
const { createRecommendationAgent, createLangChainRunner } = require("./agent/recommendationAgent");
const { createPreferenceMemory } = require("./preferences/preferenceMemory");

function createApp({ recommendationService, preferenceMemory } = {}) {
  const app = express();
  app.use(express.json());
  const resolvedPreferenceMemory = preferenceMemory || createPreferenceMemory();

  const resolvedRecommendationService = recommendationService;

  app.post("/recommendations", (req, res) => {
    const validation = validateRecommendationRequest(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const requestedMode = req.body?.mode === "preference-aware" ? "preference-aware" : "fresh";
    const preferenceContext =
      requestedMode === "preference-aware" ? resolvedPreferenceMemory.buildContext() : "";

    return getRecommendationService(resolvedRecommendationService)
      .getRecommendations(validation.query, {
        mode: requestedMode,
        preferenceContext,
      })
      .then((recommendations) =>
        res.status(200).json({
          recommendations,
          meta: {
            modeUsed: requestedMode,
            usedPreferenceContext: preferenceContext.length > 0,
          },
        }),
      )
      .catch(() =>
        res.status(502).json({
          error: "recommendation service unavailable",
        }),
      );
  });

  app.post("/preferences", (req, res) => {
    const result = resolvedPreferenceMemory.addSavedBand(req.body);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(201).json({ savedBand: result.savedBand });
  });

  app.get("/preferences", (_req, res) => {
    return res.status(200).json({
      savedBands: resolvedPreferenceMemory.listSavedBands(),
    });
  });

  app.patch("/preferences/:id", (req, res) => {
    const result = resolvedPreferenceMemory.updateSavedBand(req.params.id, req.body || {});
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(200).json({ savedBand: result.savedBand });
  });

  app.delete("/preferences/:id", (req, res) => {
    const result = resolvedPreferenceMemory.deleteSavedBand(req.params.id);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.status(200).json({ deletedId: result.deletedId });
  });

  app.get("/preferences/context", (_req, res) => {
    return res.status(200).json({
      context: resolvedPreferenceMemory.buildContext(),
    });
  });

  return app;
}

let cachedDefaultService;

function getRecommendationService(overriddenService) {
  if (overriddenService) {
    return overriddenService;
  }
  if (!cachedDefaultService) {
    cachedDefaultService = createRecommendationService({
      musicBrainzClient: createMusicBrainzClient(),
    });

    if (process.env.GEMINI_API_KEY) {
      createLangChainRunner()
        .then((runModel) => {
          cachedDefaultService = createRecommendationService({
            musicBrainzClient: createMusicBrainzClient(),
            recommendationAgent: createRecommendationAgent({ runModel }),
          });
        })
        .catch(() => {
          // Keep deterministic fallback service if LangChain initialization fails.
        });
    }
  }
  return cachedDefaultService;
}

module.exports = { createApp };
