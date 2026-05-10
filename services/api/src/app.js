const express = require("express");
const helmetLib = require("helmet");
const cors = require("cors");
const rateLimitLib = require("express-rate-limit");
const helmet = /** @type {any} */ (helmetLib.default || helmetLib);
const rateLimit = /** @type {any} */ (rateLimitLib.default || rateLimitLib);
const { validateRecommendationMode } = require("../../../shared/schemas/src/contracts");
const { version: appVersion } = require("../../../package.json");
const {
  validateRecommendationRequest,
  createRecommendationService,
} = require("./recommendations");
const { createMusicBrainzClient } = require("./integrations/musicbrainz");
const { createRecommendationAgent, createLangChainRunner } = require("./agent/recommendationAgent");
const { assertPreferenceRepository, createPreferenceRepository } = require("./preferences/preferenceRepository");
const { sendError } = require("./http/errors");

/**
 * @param {{ recommendationService?: any, preferenceRepository?: any, musicBrainzClient?: any, runtimeConfig?: any }} [options]
 */
function createApp({ recommendationService, preferenceRepository, musicBrainzClient, runtimeConfig = {} } = {}) {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: runtimeConfig.corsOrigin || "*",
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use((req, _res, next) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    _res.locals.requestId = requestId;
    const startMs = Date.now();
    _res.on("finish", () => {
      console.log(
        JSON.stringify({
          level: "info",
          requestId,
          method: req.method,
          path: req.path,
          status: _res.statusCode,
          durationMs: Date.now() - startMs,
        }),
      );
    });
    next();
  });

  const recommendationsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: "rate_limit_exceeded",
        message: "too many recommendation requests",
      },
    },
  });

  const resolvedPreferenceRepository = assertPreferenceRepository(
    preferenceRepository || createPreferenceRepository(runtimeConfig),
  );

  const resolvedMusicBrainzClient = musicBrainzClient || createMusicBrainzClient({
    timeoutMs: runtimeConfig.musicBrainzTimeoutMs,
    retries: runtimeConfig.musicBrainzRetries,
  });

  let defaultRecommendationService = null;

  function resolveRecommendationService() {
    if (recommendationService) return recommendationService;
    if (!defaultRecommendationService) {
      defaultRecommendationService = createRecommendationService({ musicBrainzClient: resolvedMusicBrainzClient });
      if (process.env.GEMINI_API_KEY) {
        createLangChainRunner({ timeoutMs: runtimeConfig.recommendationTimeoutMs })
          .then((runModel) => {
            defaultRecommendationService = createRecommendationService({
              musicBrainzClient: resolvedMusicBrainzClient,
              recommendationAgent: createRecommendationAgent({ runModel }),
            });
          })
          .catch(() => {
            // Keep deterministic fallback service if LangChain initialization fails.
          });
      }
    }
    return defaultRecommendationService;
  }

  app.get("/health", (_req, res) => {
    return res.status(200).json({ status: "ok" });
  });

  app.get("/version", (_req, res) => {
    return res.status(200).json({ version: appVersion });
  });

  app.get("/artists/search", async (req, res) => {
    const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
    if (!query) {
      return sendError(res, 400, "validation_error", "query parameter is required");
    }
    const artists = await resolvedMusicBrainzClient.searchArtists(query);
    return res.status(200).json({ artists });
  });

  app.post("/recommendations", recommendationsLimiter, async (req, res) => {
    const validation = validateRecommendationRequest(req.body);
    if (!validation.ok) {
      return sendError(res, 400, "validation_error", validation.error);
    }

    const requestedMode = validateRecommendationMode(req.body?.mode);
    const selectedArtistIds = Array.isArray(req.body?.selectedArtistIds)
      ? req.body.selectedArtistIds.filter((id) => typeof id === "string")
      : [];
    const priorityContext = typeof req.body?.priorityContext === "string" ? req.body.priorityContext.trim() : "";

    let preferenceContext = priorityContext;
    if (requestedMode === "preference-aware") {
      let repoContext;
      if (selectedArtistIds.length > 0 && resolvedPreferenceRepository.buildContextForIds) {
        repoContext = await resolvedPreferenceRepository.buildContextForIds(selectedArtistIds);
      } else {
        repoContext = await resolvedPreferenceRepository.buildContext();
      }
      preferenceContext = [preferenceContext, repoContext].filter(Boolean).join("\n");
    }

    try {
      const recommendations = await resolveRecommendationService().getRecommendations(validation.query, {
        mode: requestedMode,
        preferenceContext,
      });
      return res.status(200).json({
        recommendations,
        meta: {
          modeUsed: requestedMode,
          usedPreferenceContext: preferenceContext.length > 0,
        },
      });
    } catch {
      return sendError(res, 502, "recommendation_unavailable", "recommendation service unavailable");
    }
  });

  app.post("/preferences", async (req, res) => {
    const result = await resolvedPreferenceRepository.addSavedBand(req.body);
    if (!result.ok) {
      return sendError(res, 400, "validation_error", result.error);
    }
    return res.status(201).json({ savedBand: result.savedBand });
  });

  app.get("/preferences", async (_req, res) => {
    const savedBands = await resolvedPreferenceRepository.listSavedBands();
    return res.status(200).json({
      savedBands,
    });
  });

  app.patch("/preferences/:id", async (req, res) => {
    const result = await resolvedPreferenceRepository.updateSavedBand(req.params.id, req.body || {});
    if (!result.ok) {
      return sendError(res, result.status, "preference_update_failed", result.error);
    }
    return res.status(200).json({ savedBand: result.savedBand });
  });

  app.delete("/preferences/:id", async (req, res) => {
    const result = await resolvedPreferenceRepository.deleteSavedBand(req.params.id);
    if (!result.ok) {
      return sendError(res, result.status, "preference_delete_failed", result.error);
    }
    return res.status(200).json({ deletedId: result.deletedId });
  });

  app.get("/preferences/context", async (_req, res) => {
    const context = await resolvedPreferenceRepository.buildContext();
    return res.status(200).json({
      context,
    });
  });

  app.get("/search/artists", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) {
      return sendError(res, 400, "validation_error", "query parameter q is required");
    }
    try {
      const artists = await resolvedMusicBrainzClient.searchArtists(q);
      return res.status(200).json({ artists });
    } catch {
      return sendError(res, 502, "search_unavailable", "artist search unavailable");
    }
  });

  app.use((req, res) => sendError(res, 404, "not_found", `route not found: ${req.path}`));
  app.use((error, req, res, next) => {
    void next;
    console.error(
      JSON.stringify({
        level: "error",
        requestId: res.locals.requestId,
        message: error?.message || "unexpected error",
      }),
    );
    return sendError(res, 500, "internal_error", "unexpected server error");
  });

  return app;
}

module.exports = { createApp };
