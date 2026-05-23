import type { Express, RequestHandler } from "express";

import { validateRecommendationRequest } from "../recommendations.js";
import { sendError } from "../http/errors.js";
import { handleArtistSearch } from "../http/artistSearchHandler.js";
import { writeStructuredLog } from "../http/structuredLog.js";

type Group = { id: string; name: string; memberIds: string[] };

export type BandsearchRouteContext = {
  appVersion: string;
  recommendationsLimiter: RequestHandler;
  resolvedPreferenceRepository: {
    addSavedBand: (body: unknown) => Promise<{ ok: boolean; error?: string; savedBand?: unknown; status?: number }>;
    listSavedBands: () => Promise<unknown[]>;
    updateSavedBand: (
      id: string,
      body: Record<string, unknown>,
    ) => Promise<{ ok: boolean; error?: string; savedBand?: unknown; status: number }>;
    deleteSavedBand: (id: string) => Promise<{ ok: boolean; error?: string; deletedId?: string; status: number }>;
    buildContext: () => Promise<string>;
    importSavedBands: (bands: unknown[]) => Promise<{ imported: number; skipped: number }>;
    listGroups: () => Promise<Group[]>;
    createGroup: (name: string) => Promise<{ ok: boolean; error?: string; status?: number; group?: Group }>;
    renameGroup: (id: string, name: string) => Promise<{ ok: boolean; error?: string; status?: number; group?: Group }>;
    deleteGroup: (id: string) => Promise<{ ok: boolean; error?: string; status?: number; deletedId?: string }>;
    addArtistToGroup: (groupId: string, savedBandId: string) => Promise<{ ok: boolean; error?: string; status?: number }>;
    removeArtistFromGroup: (groupId: string, savedBandId: string) => Promise<{ ok: boolean; error?: string; status?: number }>;
  };
  resolvedMusicBrainzClient: {
    searchArtists: (q: string) => Promise<unknown[]>;
    lookupArtist?: (mbid: string) => Promise<{ id: string; name: string; genres: string[]; tags: string[] }>;
  };
  resolvedArtistImageClient: { getArtistImageUrl: (name: string) => Promise<string | null> };
  resolvedChatSessionRepository: {
    createSession: (input: { title: string }) => Promise<Record<string, unknown>>;
    listSessions: () => Promise<Record<string, unknown>[]>;
    getSession: (id: string) => Promise<Record<string, unknown> | null>;
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
  } = ctx;

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
    const session = await resolvedChatSessionRepository.createSession({ title });
    return res.status(201).json({
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.created_at || session.createdAt,
      },
    });
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
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at || m.createdAt,
      })),
    });
  });

  app.post("/sessions/:id/messages", async (req, res) => {
    const session = await resolvedChatSessionRepository.getSession(req.params.id);
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
      });
      return res.status(200).json({
        recommendations: pipelineResult.recommendations,
        assistantReply: pipelineResult.assistantReply ?? "",
        meta: pipelineResult.meta,
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
    const result = await resolvedPreferenceRepository.addSavedBand(req.body);
    if (!result.ok) {
      return sendError(res, 400, "validation_error", result.error ?? "validation failed");
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
      return sendError(res, result.status, "preference_update_failed", result.error ?? "update failed");
    }
    return res.status(200).json({ savedBand: result.savedBand });
  });

  app.delete("/preferences/:id", async (req, res) => {
    const result = await resolvedPreferenceRepository.deleteSavedBand(req.params.id);
    if (!result.ok) {
      return sendError(res, result.status, "preference_delete_failed", result.error ?? "delete failed");
    }
    return res.status(200).json({ deletedId: result.deletedId });
  });

  app.get("/preferences/context", async (_req, res) => {
    const context = await resolvedPreferenceRepository.buildContext();
    return res.status(200).json({
      context,
    });
  });

  app.get("/preferences/export", async (_req, res) => {
    const savedBands = await resolvedPreferenceRepository.listSavedBands();
    res.setHeader("Content-Disposition", 'attachment; filename="bandsearch-artists.json"');
    return res.status(200).json(savedBands);
  });

  app.post("/preferences/import", async (req, res) => {
    if (!Array.isArray(req.body)) {
      return sendError(res, 400, "validation_error", "body must be an array of saved bands");
    }
    const result = await resolvedPreferenceRepository.importSavedBands(req.body);
    return res.status(200).json(result);
  });

  app.get("/preferences/groups", async (_req, res) => {
    const groups = await resolvedPreferenceRepository.listGroups();
    return res.status(200).json({ groups });
  });

  app.post("/preferences/groups/auto", async (_req, res) => {
    const savedBands = (await resolvedPreferenceRepository.listSavedBands()) as Array<Record<string, unknown>>;
    const existingGroups = await resolvedPreferenceRepository.listGroups();
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
          const createResult = await resolvedPreferenceRepository.createGroup(genre);
          if (createResult.ok && createResult.group) {
            groupByName.set(genre, createResult.group);
          }
        }
        const group = groupByName.get(genre);
        if (group && typeof band.id === "string") {
          await resolvedPreferenceRepository.addArtistToGroup(group.id, band.id);
        }
      }
    }

    const groups = await resolvedPreferenceRepository.listGroups();
    return res.status(200).json({ groups });
  });

  app.post("/preferences/groups", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const result = await resolvedPreferenceRepository.createGroup(name);
    if (!result.ok) {
      return sendError(res, result.status ?? 400, result.status === 409 ? "group_name_conflict" : "validation_error", result.error ?? "failed");
    }
    return res.status(201).json({ group: result.group });
  });

  app.patch("/preferences/groups/:id", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const result = await resolvedPreferenceRepository.renameGroup(req.params.id, name);
    if (!result.ok) {
      return sendError(res, result.status ?? 400, "group_update_failed", result.error ?? "failed");
    }
    return res.status(200).json({ group: result.group });
  });

  app.delete("/preferences/groups/:id", async (req, res) => {
    const result = await resolvedPreferenceRepository.deleteGroup(req.params.id);
    if (!result.ok) {
      return sendError(res, result.status ?? 404, "group_delete_failed", result.error ?? "failed");
    }
    return res.status(200).json({ deletedId: result.deletedId });
  });

  app.post("/preferences/groups/:id/artists", async (req, res) => {
    const savedBandId = typeof req.body?.savedBandId === "string" ? req.body.savedBandId : "";
    if (!savedBandId) return sendError(res, 400, "validation_error", "savedBandId is required");
    const result = await resolvedPreferenceRepository.addArtistToGroup(req.params.id, savedBandId);
    if (!result.ok) {
      return sendError(res, result.status ?? 400, "group_member_add_failed", result.error ?? "failed");
    }
    return res.status(200).json({ ok: true });
  });

  app.delete("/preferences/groups/:id/artists/:savedBandId", async (req, res) => {
    const result = await resolvedPreferenceRepository.removeArtistFromGroup(req.params.id, req.params.savedBandId);
    if (!result.ok) {
      return sendError(res, result.status ?? 404, "group_member_remove_failed", result.error ?? "failed");
    }
    return res.status(200).json({ ok: true });
  });
}
