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
const { createPreferenceMemory } = require("./preferences/preferenceMemory");
const { sendError } = require("./http/errors");

/**
 * @param {{ recommendationService?: any, preferenceMemory?: any, runtimeConfig?: any }} [options]
 */
function createApp({ recommendationService, preferenceMemory, runtimeConfig = {} } = {}) {
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

  const resolvedPreferenceMemory = preferenceMemory || createPreferenceMemory();

  const resolvedRecommendationService = recommendationService;

  app.get("/health", (_req, res) => {
    return res.status(200).json({ status: "ok" });
  });

  app.get("/version", (_req, res) => {
    return res.status(200).json({ version: appVersion });
  });

  app.post("/recommendations", recommendationsLimiter, (req, res) => {
    const validation = validateRecommendationRequest(req.body);
    if (!validation.ok) {
      return sendError(res, 400, "validation_error", validation.error);
    }

    const requestedMode = validateRecommendationMode(req.body?.mode);
    const preferenceContext =
      requestedMode === "preference-aware" ? resolvedPreferenceMemory.buildContext() : "";

    return getRecommendationService(resolvedRecommendationService, runtimeConfig)
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
        sendError(res, 502, "recommendation_unavailable", "recommendation service unavailable"),
      );
  });

  app.post("/preferences", (req, res) => {
    const result = resolvedPreferenceMemory.addSavedBand(req.body);
    if (!result.ok) {
      return sendError(res, 400, "validation_error", result.error);
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
      return sendError(res, result.status, "preference_update_failed", result.error);
    }
    return res.status(200).json({ savedBand: result.savedBand });
  });

  app.delete("/preferences/:id", (req, res) => {
    const result = resolvedPreferenceMemory.deleteSavedBand(req.params.id);
    if (!result.ok) {
      return sendError(res, result.status, "preference_delete_failed", result.error);
    }
    return res.status(200).json({ deletedId: result.deletedId });
  });

  app.get("/preferences/context", (_req, res) => {
    return res.status(200).json({
      context: resolvedPreferenceMemory.buildContext(),
    });
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

let cachedDefaultService;

function getRecommendationService(overriddenService, runtimeConfig) {
  if (overriddenService) {
    return overriddenService;
  }
  if (!cachedDefaultService) {
    cachedDefaultService = createRecommendationService({
      musicBrainzClient: createMusicBrainzClient({
        timeoutMs: runtimeConfig.musicBrainzTimeoutMs,
        retries: runtimeConfig.musicBrainzRetries,
      }),
    });

    if (process.env.GEMINI_API_KEY) {
      createLangChainRunner({ timeoutMs: runtimeConfig.recommendationTimeoutMs })
        .then((runModel) => {
          cachedDefaultService = createRecommendationService({
            musicBrainzClient: createMusicBrainzClient({
              timeoutMs: runtimeConfig.musicBrainzTimeoutMs,
              retries: runtimeConfig.musicBrainzRetries,
            }),
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
