/* eslint-disable @typescript-eslint/no-explicit-any */
import express from "express";
import helmetLib from "helmet";
import cors from "cors";
import rateLimitLib from "express-rate-limit";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";

const helmet = (helmetLib as any).default || helmetLib;
const rateLimit = (rateLimitLib as any).default || rateLimitLib;

// Read package.json version (CJS-compatible)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: appVersion } = require("../../../package.json") as { version: string };

import { createMusicBrainzClient } from "./integrations/musicbrainz.js";
import { createWikidataImageClient } from "./integrations/wikidataImageClient.js";
import { assertPreferenceRepository, createPreferenceRepository } from "./preferences/preferenceRepository.js";
import { createInMemoryChatSessionRepository, createSqliteChatSessionRepository } from "./sessions/chatSessionRepository.js";
import { createSqliteUserRepository, createInMemoryUserRepository } from "./auth/userRepository.js";
import { createTursoUserRepository } from "./auth/tursoUserRepository.js";
import { createAuthService } from "./auth/authService.js";
import { createAuthMiddleware } from "./auth/authMiddleware.js";
import { sendError } from "./http/errors.js";
import { writeStructuredLog } from "./http/structuredLog.js";
import { registerBandsearchRoutes } from "./routes/registerBandsearchRoutes.js";

export function createApp({
  recommendationPipeline,
  preferenceRepository,
  userRepository,
  musicBrainzClient,
  artistImageClient,
  chatSessionRepository,
  runtimeConfig = {},
  logger,
  createTursoClient,
}: {
  recommendationPipeline?: any;
  preferenceRepository?: any;
  userRepository?: any;
  musicBrainzClient?: any;
  artistImageClient?: any;
  chatSessionRepository?: any;
  runtimeConfig?: any;
  logger?: { warn: (obj: Record<string, unknown>) => void };
  createTursoClient?: (config: { url: string; authToken?: string }) => { execute: (sql: string) => Promise<unknown> };
} = {}) {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: runtimeConfig.corsOrigin || "*",
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use((req: any, _res: any, next: any) => {
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
        const db = new Database(runtimeConfig.databasePath || "bandsearch.db");
        return createSqliteChatSessionRepository({ db });
      } catch {
        return createInMemoryChatSessionRepository();
      }
    })();

  const resolvedUserRepository =
    userRepository ||
    (() => {
      if (runtimeConfig.preferenceStore === "turso") {
        const client = createClient({
          url: runtimeConfig.tursoDatabaseUrl,
          authToken: runtimeConfig.tursoAuthToken,
        });
        return createTursoUserRepository({ client });
      }
      try {
        const db = new Database(runtimeConfig.databasePath || "bandsearch.db");
        return createSqliteUserRepository({ db });
      } catch {
        return createInMemoryUserRepository();
      }
    })();

  const jwtSecret = runtimeConfig.jwtSecret;
  const resolvedAuthService = jwtSecret
    ? createAuthService({ userRepository: resolvedUserRepository, jwtSecret })
    : null;
  const authMiddleware = resolvedAuthService
    ? createAuthMiddleware(resolvedAuthService, resolvedUserRepository)
    : null;

  registerBandsearchRoutes(app, {
    appVersion,
    recommendationsLimiter,
    resolvedPreferenceRepository,
    resolvedMusicBrainzClient,
    resolvedArtistImageClient,
    resolvedChatSessionRepository,
    resolvedRecommendationPipeline: recommendationPipeline,
    createTursoClient,
    logger,
    resolvedAuthService,
    authMiddleware,
    getRecommendationReadiness:
      typeof recommendationPipeline?.getReadinessSnapshot === "function"
        ? () => recommendationPipeline.getReadinessSnapshot()
        : null,
  });

  app.use((req: any, res: any) => sendError(res, 404, "not_found", `route not found: ${req.path}`));
  app.use((error: any, req: any, res: any, next: any) => {
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
