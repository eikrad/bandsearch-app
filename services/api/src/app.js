const express = require("express");
const helmetLib = require("helmet");
const cors = require("cors");
const rateLimitLib = require("express-rate-limit");
const helmet = /** @type {any} */ (helmetLib.default || helmetLib);
const rateLimit = /** @type {any} */ (rateLimitLib.default || rateLimitLib);
const { version: appVersion } = require("../../../package.json");
const { validateRecommendationRequest, createRecommendationError, resolveRecommendationFacadeInput } = require("./recommendations");
const { createMusicBrainzClient } = require("./integrations/musicbrainz");
const { createWikidataImageClient } = require("./integrations/wikidataImageClient");
const { assertPreferenceRepository, createPreferenceRepository } = require("./preferences/preferenceRepository");
const { createInMemoryChatSessionRepository, createSqliteChatSessionRepository } = require("./sessions/chatSessionRepository");
const { sendError } = require("./http/errors");

/**
 * @param {{ recommendationPipeline?: any, recommendationService?: any, preferenceRepository?: any, musicBrainzClient?: any, artistImageClient?: any, chatSessionRepository?: any, runtimeConfig?: any }} [options]
 */
function createApp({
  recommendationPipeline,
  recommendationService,
  preferenceRepository,
  musicBrainzClient,
  artistImageClient,
  chatSessionRepository,
  runtimeConfig = {},
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

  const resolvedArtistImageClient =
    artistImageClient ||
    createWikidataImageClient({
      timeoutMs: runtimeConfig.wikidataTimeoutMs || 8000,
      lastFmApiKey: runtimeConfig.lastFmApiKey || process.env.LASTFM_API_KEY || "",
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

      const recommendations = await recommendationService.getRecommendations(request.query, {
        mode,
        preferenceContext,
        messages,
      });
      return {
        recommendations,
        meta: {
          modeUsed: mode,
          usedPreferenceContext: preferenceContext.length > 0,
        },
      };
    },
  };

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

  app.get("/artists/image", async (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (!name) {
      return sendError(res, 400, "validation_error", "name parameter is required");
    }
    const imageUrl = await resolvedArtistImageClient.getArtistImageUrl(name);
    return res.status(200).json({ imageUrl: imageUrl || null });
  });

  app.post("/sessions", async (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "Untitled";
    const session = await resolvedChatSessionRepository.createSession({ title });
    return res.status(201).json({ session: { id: session.id, title: session.title, createdAt: session.created_at || session.createdAt } });
  });

  app.get("/sessions", async (_req, res) => {
    const sessions = await resolvedChatSessionRepository.listSessions();
    return res.status(200).json({
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updated_at || s.updatedAt })),
    });
  });

  app.get("/sessions/:id", async (req, res) => {
    const session = await resolvedChatSessionRepository.getSession(req.params.id);
    if (!session) return sendError(res, 404, "not_found", "session not found");
    const messages = await resolvedChatSessionRepository.getMessages(req.params.id);
    return res.status(200).json({
      session: { id: session.id, title: session.title, createdAt: session.created_at || session.createdAt },
      messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.created_at || m.createdAt })),
    });
  });

  app.post("/sessions/:id/messages", async (req, res) => {
    const session = await resolvedChatSessionRepository.getSession(req.params.id);
    if (!session) return sendError(res, 404, "not_found", "session not found");
    const role = typeof req.body?.role === "string" ? req.body.role : "user";
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const message = await resolvedChatSessionRepository.addMessage(req.params.id, { role, content });
    return res.status(201).json({
      message: { id: message.id, role: message.role, content: message.content, createdAt: message.created_at || message.createdAt },
    });
  });

  app.post("/recommendations", recommendationsLimiter, async (req, res) => {
    const validation = validateRecommendationRequest(req.body);
    if (!validation.ok) {
      return sendError(res, 400, "validation_error", validation.error);
    }

    try {
      const pipelineResult = await resolvedRecommendationPipeline.recommend({
        query: validation.query,
        mode: req.body?.mode,
        selectedArtistIds: req.body?.selectedArtistIds,
        priorityContext: req.body?.priorityContext,
        messages: req.body?.messages,
      });
      return res.status(200).json({
        recommendations: pipelineResult.recommendations,
        meta: pipelineResult.meta,
      });
    } catch (error) {
      if (error?.code === "recommendation_initializing") {
        return sendError(res, 503, "recommendation_initializing", "recommendation pipeline is initializing");
      }
      if (error?.code === "recommendation_context_unavailable") {
        return sendError(res, 502, "recommendation_context_unavailable", "recommendation context unavailable");
      }
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
