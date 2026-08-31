import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmetLib from "helmet";
import cors from "cors";
import rateLimitLib from "express-rate-limit";
import Database from "better-sqlite3";
import { createClient } from "@libsql/client";
import type { UserRepository } from "./auth/userRepository.js";
import type { PreferenceRepository } from "./preferences/preferenceRepository.js";
import { createNoOpEvalRepository, createInMemoryEvalRepository, createSqliteEvalRepository } from "./eval/evalRepository.js";
import type { EvalRepository } from "./eval/evalRepository.js";
import { createNoOpEvalWorker, createEvalWorker } from "./eval/evalWorker.js";
import type { EvalWorker } from "./eval/evalWorker.js";
import { createLastFmClient } from "./eval/lastFmClient.js";
import { createJudgeWorker, createNoOpJudgeWorker } from "./eval/judgeWorker.js";

// ESM/CJS interop — these modules may wrap their export in a .default in some build environments
const helmet = ((helmetLib as unknown as { default?: typeof helmetLib }).default) ?? helmetLib;
const rateLimit = ((rateLimitLib as unknown as { default?: typeof rateLimitLib }).default) ?? rateLimitLib;

// Read package.json version (CJS-compatible)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: appVersion } = require("../../../package.json") as { version: string };

import { createMusicBrainzClient } from "./integrations/musicbrainz.js";
import { createWikidataImageClient } from "./integrations/wikidataImageClient.js";
import { createPreferenceRepository, splitPreferenceRepository } from "./preferences/preferenceRepository.js";
import { createInMemoryChatSessionRepository, createSqliteChatSessionRepository } from "./sessions/chatSessionRepository.js";
import { createTursoChatSessionRepository } from "./sessions/tursoChatSessionRepository.js";
import { createSqliteUserDataStore } from "./privacy/userDataStore.js";
import { createTursoUserDataStore } from "./privacy/tursoUserDataStore.js";
import type { UserDataStore } from "./privacy/userDataStore.js";
import { createSqliteUserRepository, createInMemoryUserRepository } from "./auth/userRepository.js";
import { createTursoUserRepository } from "./auth/tursoUserRepository.js";
import { createAuthService } from "./auth/authService.js";
import { createAuthMiddleware } from "./auth/authMiddleware.js";
import { sendError } from "./http/errors.js";
import { writeStructuredLog } from "./http/structuredLog.js";
import { registerBandsearchRoutes } from "./routes/registerBandsearchRoutes.js";
import type { BandsearchRouteContext } from "./routes/registerBandsearchRoutes.js";

type AppRuntimeConfig = {
  corsOrigin?: string;
  databasePath?: string;
  preferenceStore?: string;
  tursoDatabaseUrl?: string;
  tursoAuthToken?: string;
  musicBrainzTimeoutMs?: number;
  musicBrainzRetries?: number;
  wikidataTimeoutMs?: number;
  lastFmApiKey?: string;
  mistralApiKey?: string;
  evalDashboardPassword?: string;
  jwtSecret?: string;
  evalDashboardEnabled?: boolean;
  evalRetentionDays?: number;
};

type CreateAppOptions = {
  recommendationPipeline?: BandsearchRouteContext["resolvedRecommendationPipeline"] & {
    whenReady?: () => Promise<void>;
    getReadinessSnapshot?: () => Record<string, unknown>;
  };
  preferenceRepository?: PreferenceRepository;
  userRepository?: UserRepository;
  userDataStore?: UserDataStore;
  musicBrainzClient?: BandsearchRouteContext["resolvedMusicBrainzClient"];
  artistImageClient?: BandsearchRouteContext["resolvedArtistImageClient"];
  chatSessionRepository?: BandsearchRouteContext["resolvedChatSessionRepository"];
  evalRepository?: EvalRepository;
  evalWorker?: EvalWorker;
  runtimeConfig?: AppRuntimeConfig;
  logger?: BandsearchRouteContext["logger"];
  createTursoClient?: BandsearchRouteContext["createTursoClient"];
};

export function createApp({
  recommendationPipeline,
  preferenceRepository,
  userRepository,
  userDataStore,
  musicBrainzClient,
  artistImageClient,
  chatSessionRepository,
  evalRepository,
  evalWorker,
  runtimeConfig = {},
  logger,
  createTursoClient,
}: CreateAppOptions = {}) {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: runtimeConfig.corsOrigin || "*",
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    res.locals.requestId = requestId;
    const startMs = Date.now();
    res.on("finish", () => {
      writeStructuredLog("info", {
        component: "http_request",
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
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

  // One backend, handed on as two narrow views: the routes take the half they
  // touch, and the recommendation pipeline sees only the band side.
  const { bands: resolvedBandRepository, groups: resolvedBandGroupRepository } =
    splitPreferenceRepository(preferenceRepository || createPreferenceRepository(runtimeConfig));

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

  // One SQLite handle for every repository that wants one. Previously each
  // resolver opened its own connection to the same file; memoizing gives
  // fewer handles and one place to set pragmas later.
  //
  // preferenceRepository.ts deliberately keeps its own connection — it is the
  // only one with foreign_keys=ON, and merging it would change enforcement
  // semantics for artist_group_members.
  let sqliteDatabase: Database.Database | null = null;
  const openSqliteDatabase = () => {
    sqliteDatabase ??= new Database(runtimeConfig.databasePath || "bandsearch.db");
    return sqliteDatabase;
  };

  const sharedTursoClient =
    !chatSessionRepository && !userRepository && runtimeConfig.preferenceStore === "turso"
      ? createClient({
          url: runtimeConfig.tursoDatabaseUrl ?? "",
          authToken: runtimeConfig.tursoAuthToken,
        })
      : null;

  const resolvedChatSessionRepository =
    chatSessionRepository ||
    (() => {
      if (sharedTursoClient) return createTursoChatSessionRepository({ client: sharedTursoClient });
      try {
        return createSqliteChatSessionRepository({ db: openSqliteDatabase() });
      } catch {
        return createInMemoryChatSessionRepository();
      }
    })();

  const resolvedUserRepository =
    userRepository ||
    (() => {
      if (sharedTursoClient) return createTursoUserRepository({ client: sharedTursoClient });
      try {
        return createSqliteUserRepository({ db: openSqliteDatabase() });
      } catch {
        return createInMemoryUserRepository();
      }
    })();

  // Where a user's rows actually live, resolved the same way the other
  // repositories are. Null on backends that cannot erase (in-memory), so
  // deletion reports itself unavailable rather than silently succeeding.
  const resolvedUserDataStore: UserDataStore | null =
    userDataStore ??
    (() => {
      if (sharedTursoClient) return createTursoUserDataStore({ client: sharedTursoClient });
      // An in-memory install has nothing durable to erase from. Returning null
      // makes deletion report itself unavailable, which is the honest answer —
      // an erasure that reports success without erasing is worse than one that
      // admits it cannot run.
      if (runtimeConfig.preferenceStore === "memory") return null;
      try {
        return createSqliteUserDataStore({ db: openSqliteDatabase() });
      } catch {
        return null;
      }
    })();

  const jwtSecret = runtimeConfig.jwtSecret;
  const resolvedAuthService = jwtSecret
    ? createAuthService({
        userRepository: resolvedUserRepository,
        jwtSecret,
        userDataStore: resolvedUserDataStore,
      })
    : null;
  const authMiddleware = resolvedAuthService
    ? createAuthMiddleware(resolvedAuthService, resolvedUserRepository)
    : null;

  // Eval repository and worker share a single store so the /eval routes read
  // exactly what the worker writes. When no store is injected we keep events
  // in memory while the dashboard is enabled, otherwise everything is a no-op.
  const resolvedEvalRepository: EvalRepository =
    evalRepository ??
    (() => {
      if (!runtimeConfig.evalDashboardEnabled) return createNoOpEvalRepository();
      try {
        return createSqliteEvalRepository({ db: openSqliteDatabase() });
      } catch {
        return createInMemoryEvalRepository();
      }
    })();
  // GDPR Art. 5(1)(e): enforce the stated retention period for pipeline
  // telemetry. Only armed where the eval store is real — with the no-op
  // repository (the production default, EVAL_DASHBOARD_ENABLED=false) there is
  // nothing persisted to purge. .unref() so it never holds the process open,
  // which would hang `node --test` and the CLI scripts.
  if (runtimeConfig.evalDashboardEnabled) {
    const retentionDays = runtimeConfig.evalRetentionDays ?? 90;
    const purgeExpiredEvents = () => {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      void resolvedEvalRepository.purgeEventsOlderThan(cutoff).catch(() => {
        // A failed purge must never take the API down; the next tick retries.
      });
    };
    purgeExpiredEvents();
    setInterval(purgeExpiredEvents, 24 * 60 * 60 * 1000).unref();
  }

  const resolvedJudgeWorker = runtimeConfig.mistralApiKey
    ? createJudgeWorker({
        mistralApiKey: runtimeConfig.mistralApiKey,
        evalRepository: resolvedEvalRepository,
      })
    : createNoOpJudgeWorker();

  const resolvedEvalWorker: EvalWorker =
    evalWorker ??
    (runtimeConfig.evalDashboardEnabled
      ? createEvalWorker({
          evalRepository: resolvedEvalRepository,
          lastFmClient: runtimeConfig.lastFmApiKey
            ? createLastFmClient({ apiKey: runtimeConfig.lastFmApiKey })
            : undefined,
          judgeWorker: resolvedJudgeWorker,
        })
      : createNoOpEvalWorker());

  registerBandsearchRoutes(app, {
    appVersion,
    recommendationsLimiter,
    resolvedBandRepository,
    resolvedBandGroupRepository,
    resolvedMusicBrainzClient,
    resolvedArtistImageClient,
    resolvedChatSessionRepository,
    resolvedRecommendationPipeline: recommendationPipeline,
    createTursoClient,
    logger,
    resolvedAuthService: resolvedAuthService ?? undefined,
    authMiddleware: authMiddleware ?? undefined,
    resolvedUserDataStore,
    getRecommendationReadiness:
      typeof recommendationPipeline?.getReadinessSnapshot === "function"
        ? () => recommendationPipeline.getReadinessSnapshot!()
        : null,
    evalWorker: resolvedEvalWorker,
    evalRepository: resolvedEvalRepository,
    evalDashboardEnabled: runtimeConfig.evalDashboardEnabled ?? false,
    evalDashboardPassword: runtimeConfig.evalDashboardPassword,
  });

  app.use((req: Request, res: Response) => sendError(res, 404, "not_found", `route not found: ${req.path}`));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    writeStructuredLog("error", {
      component: "http_error",
      requestId: res.locals.requestId as string,
      message: error instanceof Error ? error.message : "unexpected error",
    });
    return sendError(res, 500, "internal_error", "unexpected server error");
  });

  return app;
}
