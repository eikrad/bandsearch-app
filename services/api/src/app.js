const express = require("express");
const helmetLib = require("helmet");
const cors = require("cors");
const rateLimitLib = require("express-rate-limit");
const helmet = /** @type {any} */ (helmetLib.default || helmetLib);
const rateLimit = /** @type {any} */ (rateLimitLib.default || rateLimitLib);
const { version: appVersion } = require("../../../package.json");
const { createRecommendationError, resolveRecommendationFacadeInput } = require("./recommendations");
const { createMusicBrainzClient } = require("./integrations/musicbrainz");
const { createWikidataImageClient } = require("./integrations/wikidataImageClient");
const { assertPreferenceRepository, createPreferenceRepository } = require("./preferences/preferenceRepository");
const { createInMemoryChatSessionRepository, createSqliteChatSessionRepository } = require("./sessions/chatSessionRepository");
const { sendError } = require("./http/errors");
const { writeStructuredLog } = require("./http/structuredLog");
const { registerBandsearchRoutes } = require("./routes/registerBandsearchRoutes");

/**
 * @param {{ recommendationPipeline?: any, recommendationService?: any, preferenceRepository?: any, musicBrainzClient?: any, artistImageClient?: any, chatSessionRepository?: any, runtimeConfig?: any, logger?: { warn: (obj: Record<string, unknown>) => void } }} [options]
 */
function createApp({
  recommendationPipeline,
  recommendationService,
  preferenceRepository,
  musicBrainzClient,
  artistImageClient,
  chatSessionRepository,
  runtimeConfig = {},
  logger,
} = {}) {
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
      writeStructuredLog("info", {
        component: "http_request",
        requestId,
        method: req.method,
        path: req.path,
        status: _res.statusCode,
        durationMs: Date.now() - startMs,
      });
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

  const resolvedArtistImageClient =
    artistImageClient ||
    createWikidataImageClient({
      timeoutMs: runtimeConfig.wikidataTimeoutMs || 8000,
      lastFmApiKey: runtimeConfig.lastFmApiKey ?? "",
    });

  const resolvedChatSessionRepository =
    chatSessionRepository ||
    (() => {
      try {
        const Database = require("better-sqlite3");
        const db = new Database(runtimeConfig.databasePath || "bandsearch.db");
        return createSqliteChatSessionRepository({ db });
      } catch {
        return createInMemoryChatSessionRepository();
      }
    })();

  const resolvedRecommendationPipeline = recommendationPipeline || {
    async recommend(request = {}) {
      if (!recommendationService) {
        throw createRecommendationError("recommendation_unavailable", "recommendation service unavailable");
      }

      const { mode, preferenceContext, messages } = await resolveRecommendationFacadeInput(
        request,
        resolvedPreferenceRepository,
      );

      const { recommendations, assistantReply = "" } = await recommendationService.getRecommendations(request.query, {
        mode,
        preferenceContext,
        messages,
      });
      return {
        recommendations,
        assistantReply: typeof assistantReply === "string" ? assistantReply : "",
        meta: {
          modeUsed: mode,
          usedPreferenceContext: preferenceContext.length > 0,
        },
      };
    },
  };

  registerBandsearchRoutes(app, {
    appVersion,
    recommendationsLimiter,
    resolvedPreferenceRepository,
    resolvedMusicBrainzClient,
    resolvedArtistImageClient,
    resolvedChatSessionRepository,
    resolvedRecommendationPipeline,
    logger,
    getRecommendationReadiness:
      recommendationPipeline && typeof recommendationPipeline.getReadinessSnapshot === "function"
        ? () => recommendationPipeline.getReadinessSnapshot()
        : null,
  });

  app.use((req, res) => sendError(res, 404, "not_found", `route not found: ${req.path}`));
  app.use((error, req, res, next) => {
    void next;
    writeStructuredLog("error", {
      component: "http_error",
      requestId: res.locals.requestId,
      message: error?.message || "unexpected error",
    });
    return sendError(res, 500, "internal_error", "unexpected server error");
  });

  return app;
}
module.exports = { createApp };
