import type { Express, RequestHandler } from "express";
import { createClient as createLibsqlClient } from "@libsql/client";

import { validateRecommendationRequest } from "../recommendations.js";
import { sendError } from "../http/errors.js";
import { handleArtistSearch } from "../http/artistSearchHandler.js";
import { writeStructuredLog } from "../http/structuredLog.js";
import { registerEvalRoutes } from "../eval/evalRoutes.js";
import { createNoOpEvalRepository } from "../eval/evalRepository.js";
import type { EvalWorker } from "../eval/evalWorker.js";
import type { EvalRepository, PipelineDiagnostics } from "../eval/evalRepository.js";

// Augment Express Request to carry the authenticated user id set by authMiddleware.
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global { namespace Express { interface Request { userId?: string; } } }

type Group = { id: string; name: string; memberIds: string[] };
type TursoClient = { execute: (sql: string) => Promise<unknown> };

export type BandsearchRouteContext = {
  appVersion: string;
  recommendationsLimiter: RequestHandler;
  resolvedPreferenceRepository: {
    addSavedBand: (body: unknown, userId?: string) => Promise<{ ok: boolean; error?: string; savedBand?: unknown; status?: number }>;
    listSavedBands: (userId?: string) => Promise<unknown[]>;
    updateSavedBand: (
      id: string,
      body: Record<string, unknown>,
      userId?: string,
    ) => Promise<{ ok: boolean; error?: string; savedBand?: unknown; status?: number }>;
    deleteSavedBand: (id: string, userId?: string) => Promise<{ ok: boolean; error?: string; deletedId?: string; status?: number }>;
    buildContext: (userId?: string) => Promise<string>;
    importSavedBands: (bands: unknown[], userId?: string) => Promise<{ imported: number; skipped: number; failed: number }>;
    listGroups: (userId?: string) => Promise<Group[]>;
    createGroup: (name: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number; group?: Group }>;
    renameGroup: (id: string, name: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number; group?: Group }>;
    deleteGroup: (id: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number; deletedId?: string }>;
    addArtistToGroup: (groupId: string, savedBandId: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number }>;
    removeArtistFromGroup: (groupId: string, savedBandId: string, userId?: string) => Promise<{ ok: boolean; error?: string; status?: number }>;
  };
  resolvedMusicBrainzClient: {
    searchArtists: (q: string) => Promise<unknown[]>;
    lookupArtist?: (mbid: string) => Promise<{ id: string; name: string; genres: string[]; tags: string[] }>;
  };
  resolvedArtistImageClient: { getArtistImageUrl: (name: string) => Promise<string | null> };
  resolvedChatSessionRepository: {
    createSession: (input: { title: string }, userId?: string) => Promise<Record<string, unknown>>;
    listSessions: (userId?: string) => Promise<Record<string, unknown>[]>;
    getSession: (id: string, userId?: string) => Promise<Record<string, unknown> | null>;
    getMessages: (id: string) => Promise<Record<string, unknown>[]>;
    addMessage: (id: string, msg: { role: string; content: string }) => Promise<Record<string, unknown>>;
  };
  resolvedRecommendationPipeline: {
    recommend: (req: Record<string, unknown>) => Promise<{
      recommendations: unknown[];
      assistantReply?: string;
      meta?: unknown;
    }>;
  };
  getRecommendationReadiness?: (() => Record<string, unknown>) | null;
  logger?: { warn: (obj: Record<string, unknown>) => void };
  createTursoClient?: (config: { url: string; authToken?: string }) => TursoClient;
  evalWorker?: EvalWorker;
  evalRepository?: EvalRepository;
  evalDashboardEnabled?: boolean;
  evalDashboardPassword?: string;
  resolvedAuthService?: {
    register: (input: { email: string; displayName: string; password: string }) => Promise<{ ok: boolean; user?: Record<string, unknown>; token?: string; recoveryCode?: string; error?: string }>;
    login: (input: { email: string; password: string }) => Promise<{ ok: boolean; user?: Record<string, unknown>; token?: string; error?: string }>;
    resetPassword: (input: { email: string; recoveryCode: string; newPassword: string }) => Promise<{ ok: boolean; newRecoveryCode?: string; error?: string }>;
    verifyToken: (token: string) => { ok: boolean; userId?: string; error?: string };
    getStatus: () => Promise<{ userCount: number }>;
  };
  authMiddleware?: RequestHandler;
};

export function registerBandsearchRoutes(app: Express, ctx: BandsearchRouteContext) {
  const {
    appVersion,
    recommendationsLimiter,
    resolvedPreferenceRepository,
    resolvedMusicBrainzClient,
    resolvedArtistImageClient,
    resolvedChatSessionRepository,
    resolvedRecommendationPipeline,
    getRecommendationReadiness,
    logger,
    createTursoClient,
    evalWorker,
    evalRepository,
    evalDashboardEnabled = false,
    evalDashboardPassword,
    resolvedAuthService,
    authMiddleware,
  } = ctx;

  // Always available: client needs this before any auth interaction
  app.get("/auth/status", async (_req, res) => {
    if (resolvedAuthService) {
      const { userCount } = await resolvedAuthService.getStatus();
      return res.json({ enabled: true, userCount });
    }
    return res.json({ enabled: false, userCount: 0 });
  });

  // Auth routes (public)
  if (resolvedAuthService) {
    app.post("/auth/register", async (req, res) => {
      if (process.env.REGISTRATION_OPEN === "false") {
        return sendError(res, 403, "registration_closed", "registration is currently closed");
      }
      const { email, displayName, password } = req.body ?? {};
      const result = await resolvedAuthService.register({ email: String(email ?? ""), displayName: String(displayName ?? ""), password: String(password ?? "") });
      if (!result.ok) return sendError(res, 400, "auth_error", result.error ?? "registration failed");
      return res.status(201).json({ user: result.user, token: result.token, recoveryCode: result.recoveryCode });
    });

    app.post("/auth/login", async (req, res) => {
      const { email, password } = req.body ?? {};
      const result = await resolvedAuthService.login({ email: String(email ?? ""), password: String(password ?? "") });
      if (!result.ok) return sendError(res, 401, "auth_error", result.error ?? "login failed");
      return res.status(200).json({ user: result.user, token: result.token });
    });

    app.post("/auth/reset-password", async (req, res) => {
      const { email, recoveryCode, newPassword } = req.body ?? {};
      const result = await resolvedAuthService.resetPassword({ email: String(email ?? ""), recoveryCode: String(recoveryCode ?? ""), newPassword: String(newPassword ?? "") });
      if (!result.ok) return sendError(res, 400, "auth_error", result.error ?? "reset failed");
      return res.status(200).json({ ok: true, newRecoveryCode: result.newRecoveryCode });
    });
  }

  // Apply auth middleware to protected route groups
  if (authMiddleware) {
    app.use("/preferences", authMiddleware);
    app.use("/sessions", authMiddleware);
    app.use("/recommendations", authMiddleware);
  }

  app.get("/health", (_req, res) => {
    const body: Record<string, unknown> = { status: "ok" };
    if (typeof getRecommendationReadiness === "function") {
      body.recommendations = getRecommendationReadiness();
    }
    return res.status(200).json(body);
  });

  app.get("/version", (_req, res) => {
    return res.status(200).json({ version: appVersion });
  });

  app.get("/artists/search", async (req, res) => {
    return handleArtistSearch(res, req.query.query, resolvedMusicBrainzClient);
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
    const session = await resolvedChatSessionRepository.createSession({ title }, req.userId);
    return res.status(201).json({
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.created_at || session.createdAt,
      },
    });
  });

  app.get("/sessions", async (req, res) => {
    const sessions = await resolvedChatSessionRepository.listSessions(req.userId);
    return res.status(200).json({
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updated_at || s.updatedAt })),
    });
  });

  app.get("/sessions/:id", async (req, res) => {
    const session = await resolvedChatSessionRepository.getSession(req.params.id, req.userId);
    if (!session) return sendError(res, 404, "not_found", "session not found");
    const messages = await resolvedChatSessionRepository.getMessages(req.params.id);
    return res.status(200).json({
      session: { id: session.id, title: session.title, createdAt: session.created_at || session.createdAt },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at || m.createdAt,
      })),
    });
  });

  app.post("/sessions/:id/messages", async (req, res) => {
    const session = await resolvedChatSessionRepository.getSession(req.params.id, req.userId);
    if (!session) return sendError(res, 404, "not_found", "session not found");
    const role = typeof req.body?.role === "string" ? req.body.role : "user";
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const message = await resolvedChatSessionRepository.addMessage(req.params.id, { role, content });
    return res.status(201).json({
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.created_at || message.createdAt,
      },
    });
  });

  app.post("/recommendations", recommendationsLimiter, async (req, res) => {
    const validation = validateRecommendationRequest(req.body);
    if (validation.ok === false) {
      return sendError(res, 400, "validation_error", validation.error);
    }

    if (validation.truncated.length > 0) {
      const logFn = logger?.warn ?? ((obj) => writeStructuredLog("warn", obj));
      logFn({ component: "prompt_safety", event: "prompt_safety_truncate", fields: validation.truncated });
    }

    try {
      const pipelineResult = await resolvedRecommendationPipeline.recommend({
        query: validation.query,
        mode: validation.mode,
        selectedArtistIds: validation.selectedArtistIds,
        priorityContext: validation.priorityContext,
        messages: validation.messages,
        userId: req.userId,
      });

      const { pipelineDiagnostics, ...publicMeta } = (pipelineResult.meta ?? {}) as Record<string, unknown>;
      if (evalWorker) {
        void evalWorker.processEvent({
          query: validation.query,
          mode: validation.mode,
          sessionId: typeof req.body?.sessionId === "string" ? req.body.sessionId : null,
          userId: req.userId,
          pipelineVersion: appVersion,
          pipelineDiagnostics: (pipelineDiagnostics as PipelineDiagnostics | undefined) ?? {
            braveHitCount: 0,
            extractedCandidateCount: 0,
            verifiedCount: 0,
            reflectionTriggered: false,
            searchBudgetUsed: 0,
          },
          recommendations: pipelineResult.recommendations,
        });
      }

      return res.status(200).json({
        recommendations: pipelineResult.recommendations,
        assistantReply: pipelineResult.assistantReply ?? "",
        meta: publicMeta,
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
      if (code === "recommendation_initializing") {
        return sendError(res, 503, "recommendation_initializing", "recommendation pipeline is initializing");
      }
      if (code === "recommendation_context_unavailable") {
        return sendError(res, 502, "recommendation_context_unavailable", "recommendation context unavailable");
      }
      return sendError(res, 502, "recommendation_unavailable", "recommendation service unavailable");
    }
  });

  app.post("/preferences", async (req, res) => {
    const result = await resolvedPreferenceRepository.addSavedBand(req.body, req.userId);
    if (!result.ok) {
      return sendError(res, 400, "validation_error", result.error ?? "validation failed");
    }
    return res.status(201).json({ savedBand: result.savedBand });
  });

  app.get("/preferences", async (req, res) => {
    const savedBands = await resolvedPreferenceRepository.listSavedBands(req.userId);
    return res.status(200).json({ savedBands });
  });

  app.patch("/preferences/:id", async (req, res) => {
    const result = await resolvedPreferenceRepository.updateSavedBand(req.params.id, req.body || {}, req.userId);
    if (!result.ok) {
      return sendError(res, result.status, "preference_update_failed", result.error ?? "update failed");
    }
    return res.status(200).json({ savedBand: result.savedBand });
  });

  app.delete("/preferences/:id", async (req, res) => {
    const result = await resolvedPreferenceRepository.deleteSavedBand(req.params.id, req.userId);
    if (!result.ok) {
      return sendError(res, result.status, "preference_delete_failed", result.error ?? "delete failed");
    }
    return res.status(200).json({ deletedId: result.deletedId });
  });

  app.get("/preferences/context", async (req, res) => {
    const context = await resolvedPreferenceRepository.buildContext(req.userId);
    return res.status(200).json({ context });
  });

  app.get("/preferences/export", async (req, res) => {
    const savedBands = await resolvedPreferenceRepository.listSavedBands(req.userId);
    res.setHeader("Content-Disposition", 'attachment; filename="bandsearch-artists.json"');
    return res.status(200).json(savedBands);
  });

  app.post("/preferences/import", async (req, res) => {
    if (!Array.isArray(req.body)) {
      return sendError(res, 400, "validation_error", "body must be an array of saved bands");
    }
    const result = await resolvedPreferenceRepository.importSavedBands(req.body, req.userId);
    return res.status(200).json(result);
  });

  app.get("/preferences/groups", async (req, res) => {
    const groups = await resolvedPreferenceRepository.listGroups(req.userId);
    return res.status(200).json({ groups });
  });

  app.post("/preferences/groups/auto", async (req, res) => {
    const savedBands = (await resolvedPreferenceRepository.listSavedBands(req.userId)) as Array<Record<string, unknown>>;
    const existingGroups = await resolvedPreferenceRepository.listGroups(req.userId);
    const groupByName = new Map(existingGroups.map((g) => [g.name, g]));

    for (const band of savedBands) {
      const mbid = typeof band.musicbrainzArtistId === "string" ? band.musicbrainzArtistId : null;
      if (!mbid) continue;
      let artistData: { genres: string[] } = { genres: [] };
      try {
        if (resolvedMusicBrainzClient.lookupArtist) {
          artistData = await resolvedMusicBrainzClient.lookupArtist(mbid);
        }
      } catch {
        continue;
      }
      for (const genre of artistData.genres ?? []) {
        if (!groupByName.has(genre)) {
          const createResult = await resolvedPreferenceRepository.createGroup(genre, req.userId);
          if (createResult.ok && createResult.group) {
            groupByName.set(genre, createResult.group);
          }
        }
        const group = groupByName.get(genre);
        if (group && typeof band.id === "string") {
          await resolvedPreferenceRepository.addArtistToGroup(group.id, band.id, req.userId);
        }
      }
    }

    const groups = await resolvedPreferenceRepository.listGroups(req.userId);
    return res.status(200).json({ groups });
  });

  app.post("/preferences/groups", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const result = await resolvedPreferenceRepository.createGroup(name, req.userId);
    if (!result.ok) {
      return sendError(res, result.status ?? 400, result.status === 409 ? "group_name_conflict" : "validation_error", result.error ?? "failed");
    }
    return res.status(201).json({ group: result.group });
  });

  app.patch("/preferences/groups/:id", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const result = await resolvedPreferenceRepository.renameGroup(req.params.id, name, req.userId);
    if (!result.ok) {
      return sendError(res, result.status ?? 400, "group_update_failed", result.error ?? "failed");
    }
    return res.status(200).json({ group: result.group });
  });

  app.delete("/preferences/groups/:id", async (req, res) => {
    const result = await resolvedPreferenceRepository.deleteGroup(req.params.id, req.userId);
    if (!result.ok) {
      return sendError(res, result.status ?? 404, "group_delete_failed", result.error ?? "failed");
    }
    return res.status(200).json({ deletedId: result.deletedId });
  });

  app.post("/preferences/groups/:id/artists", async (req, res) => {
    const savedBandId = typeof req.body?.savedBandId === "string" ? req.body.savedBandId : "";
    if (!savedBandId) return sendError(res, 400, "validation_error", "savedBandId is required");
    const result = await resolvedPreferenceRepository.addArtistToGroup(req.params.id, savedBandId, req.userId);
    if (!result.ok) {
      return sendError(res, result.status ?? 400, "group_member_add_failed", result.error ?? "failed");
    }
    return res.status(200).json({ ok: true });
  });

  app.delete("/preferences/groups/:id/artists/:savedBandId", async (req, res) => {
    const result = await resolvedPreferenceRepository.removeArtistFromGroup(req.params.id, req.params.savedBandId, req.userId);
    if (!result.ok) {
      return sendError(res, result.status ?? 404, "group_member_remove_failed", result.error ?? "failed");
    }
    return res.status(200).json({ ok: true });
  });

  app.post("/preferences/turso/test", async (req, res) => {
    const databaseUrl = typeof req.body?.databaseUrl === "string" ? req.body.databaseUrl.trim() : "";
    const authToken = typeof req.body?.authToken === "string" ? req.body.authToken.trim() : undefined;
    if (!databaseUrl) return sendError(res, 400, "validation_error", "databaseUrl is required");
    const factory = createTursoClient ?? ((cfg) => createLibsqlClient(cfg));
    try {
      const client = factory({ url: databaseUrl, authToken: authToken || undefined });
      await client.execute("SELECT 1");
      return res.status(200).json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "connection failed";
      return res.status(200).json({ ok: false, error: message });
    }
  });

  registerEvalRoutes(app, {
    evalRepository: evalRepository ?? createNoOpEvalRepository(),
    evalDashboardEnabled,
    evalDashboardPassword,
  });
}
