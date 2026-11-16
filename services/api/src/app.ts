import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmetLib from "helmet";
import cors from "cors";
import rateLimitLib from "express-rate-limit";
import Database from "better-sqlite3";
import { createNoOpEvalRepository, createInMemoryEvalRepository, createSqliteEvalRepository } from "./eval/evalRepository.js";
import type { EvalRepository } from "./eval/evalRepository.js";
import { createNoOpEvalWorker, createEvalWorker } from "./eval/evalWorker.js";
import type { EvalWorker } from "./eval/evalWorker.js";
import { createLastFmClient } from "./eval/lastFmClient.js";
import { createJudgeWorker, createNoOpJudgeWorker, judgeModelFor } from "./eval/judgeWorker.js";

// ESM/CJS interop — these modules may wrap their export in a .default in some build environments
const helmet = ((helmetLib as unknown as { default?: typeof helmetLib }).default) ?? helmetLib;
const rateLimit = ((rateLimitLib as unknown as { default?: typeof rateLimitLib }).default) ?? rateLimitLib;

// Read package.json version (CJS-compatible)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version: appVersion } = require("../../../package.json") as { version: string };

import { createMusicBrainzClient } from "./integrations/musicbrainz.js";
import { createWikidataImageClient } from "./integrations/wikidataImageClient.js";
import { splitPreferenceRepository } from "./preferences/preferenceRepository.js";
import { createInviteService } from "./auth/inviteService.js";
import { createAuthService } from "./auth/authService.js";
import { createAuthMiddleware } from "./auth/authMiddleware.js";
import { sendError } from "./http/errors.js";
import { writeStructuredLog } from "./http/structuredLog.js";
import { registerBandsearchRoutes } from "./routes/registerBandsearchRoutes.js";
import type { BandsearchRouteContext } from "./routes/registerBandsearchRoutes.js";
import type { LlmConfig } from "./config/models.js";
import { createStorage, type StorageConfig } from "./storage/createStorage.js";
import type { StorageRepositories } from "./storage/storageRepositories.js";

type AppRuntimeConfig = StorageConfig & {
  corsOrigin?: string;
  musicBrainzTimeoutMs?: number;
  musicBrainzRetries?: number;
  wikidataTimeoutMs?: number;
  lastFmApiKey?: string;
  /** Provider and model per role (config/models.ts); without it no judge runs. */
  llm?: LlmConfig;
  evalDashboardPassword?: string;
  jwtSecret?: string;
  /** "progressive" (default) or "enforced" — see ADR 0005. */
  authMode?: "progressive" | "enforced";
  evalDashboardEnabled?: boolean;
  evalRetentionDays?: number;
};

type CreateAppOptions = Partial<StorageRepositories> & {
  storage?: StorageRepositories;
  recommendationPipeline?: BandsearchRouteContext["resolvedRecommendationPipeline"] & {
    whenReady?: () => Promise<void>;
    getReadinessSnapshot?: () => Record<string, unknown>;
  };
  musicBrainzClient?: BandsearchRouteContext["resolvedMusicBrainzClient"];
  artistImageClient?: BandsearchRouteContext["resolvedArtistImageClient"];
  evalRepository?: EvalRepository;
  evalWorker?: EvalWorker;
  runtimeConfig?: AppRuntimeConfig;
  logger?: BandsearchRouteContext["logger"];
  createTursoClient?: BandsearchRouteContext["createTursoClient"];
};

export function createApp({
  storage,
  recommendationPipeline,
  preferenceRepository,
  userRepository,
  inviteRepository,
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
  // The API runs behind exactly one reverse proxy (Render). Trusting one hop
  // makes req.ip the client address from X-Forwarded-For instead of the
  // proxy's, so per-IP rate limits throttle the abuser, not every user at once.
  // Direct connections (local dev, tests) carry no header and are unaffected.
  app.set("trust proxy", 1);
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

  // Credential guessing and invite-code guessing both go through /auth/*.
  // 128-bit codes cannot be guessed, but passwords can, and register/reset
  // would otherwise be a free oracle for which addresses have accounts.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: "rate_limit_exceeded",
        message: "too many authentication attempts",
      },
    },
  });

  const resolvedStorage = storage ?? createStorage(runtimeConfig, {
    preferenceRepository, userRepository, inviteRepository, chatSessionRepository, userDataStore,
  });
  const {
    userRepository: resolvedUserRepository,
    inviteRepository: resolvedInviteRepository,
    chatSessionRepository: resolvedChatSessionRepository,
    userDataStore: resolvedUserDataStore,
  } = resolvedStorage;
  const resolvedInviteService = createInviteService({ inviteRepository: resolvedInviteRepository });

  // One backend, handed on as two narrow views: the routes take the half they
  // touch, and the recommendation pipeline sees only the band side.
  const { bands: resolvedBandRepository, groups: resolvedBandGroupRepository } =
    splitPreferenceRepository(resolvedStorage.preferenceRepository);

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

  const jwtSecret = runtimeConfig.jwtSecret;
  const authMode = runtimeConfig.authMode ?? "progressive";
  // Fail closed: without a secret no middleware exists, which in enforced mode
  // would mean an open server that believes itself closed.
  if (authMode === "enforced" && !jwtSecret) {
    throw new Error("JWT_SECRET is required when AUTH_MODE=enforced");
  }
  const resolvedAuthService = jwtSecret
    ? createAuthService({
        userRepository: resolvedUserRepository,
        jwtSecret,
        userDataStore: resolvedUserDataStore,
      })
    : null;
  const authMiddleware = resolvedAuthService
    ? createAuthMiddleware(resolvedAuthService, resolvedUserRepository, { mode: authMode })
    : null;

  // Optional local eval telemetry has its own SQLite connection. Account
  // repositories are assembled together above and never fall back to it.
  let evalDatabase: Database.Database | undefined;
  const openEvalDatabase = () => {
    evalDatabase ??= new Database(runtimeConfig.databasePath || ":memory:");
    return evalDatabase;
  };

  // Eval repository and worker share a single store so the /eval routes read
  // exactly what the worker writes. When no store is injected we keep events
  // in memory while the dashboard is enabled, otherwise everything is a no-op.
  const resolvedEvalRepository: EvalRepository =
    evalRepository ??
    (() => {
      if (!runtimeConfig.evalDashboardEnabled) return createNoOpEvalRepository();
      try {
        return createSqliteEvalRepository({ db: openEvalDatabase() });
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

  const judgeModel = runtimeConfig.llm ? judgeModelFor(runtimeConfig.llm) : null;
  const resolvedJudgeWorker =
    judgeModel && runtimeConfig.llm?.judge
      ? createJudgeWorker({
          judgeModel,
          modelId: runtimeConfig.llm.judge.model,
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
    authLimiter,
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
    authMode,
    resolvedInviteService,
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
