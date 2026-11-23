import { randomUUID } from "node:crypto";
import type { Express, Request, RequestHandler, Response } from "express";

import type { SearchJobState } from "../../../../shared/schemas/src/contracts.js";
import { validateRecommendationRequest } from "../recommendations.js";
import { BraveSearchError } from "../integrations/braveSearch.js";
import { answerStreamFor, openAnswerStream, wantsEventStream } from "../http/answerStream.js";
import { sendError } from "../http/errors.js";
import { writeStructuredLog } from "../http/structuredLog.js";
import type { EvalWorker } from "../eval/evalWorker.js";
import type { PipelineDiagnostics } from "../eval/evalRepository.js";
import type { SearchJobFailure, SearchJobs, SearchJobWork } from "../searchJobs/searchJobs.js";
import type { BandsearchRouteContext } from "./registerBandsearchRoutes.js";

export type RecommendationRouteDeps = {
  appVersion: string;
  /** Counts searches started; following or polling one does not. */
  recommendationsLimiter: RequestHandler;
  /** Generous: following and polling are cheap and only ever reach the caller's own jobs. */
  searchJobLimiter: RequestHandler;
  searchJobs: SearchJobs;
  pipeline?: BandsearchRouteContext["resolvedRecommendationPipeline"];
  evalWorker?: EvalWorker;
  logger?: BandsearchRouteContext["logger"];
};

/** What the client is told about a failed recommendation. */
function recommendationFailure(error: unknown, code: string): SearchJobFailure {
  if (code === "recommendation_initializing") {
    return { status: 503, code, message: "recommendation pipeline is initializing" };
  }
  if (code === "recommendation_context_unavailable") {
    return { status: 502, code, message: "recommendation context unavailable" };
  }
  if (error instanceof BraveSearchError) {
    return { status: 502, code: "search_unavailable", message: error.message };
  }
  return { status: 502, code: "recommendation_unavailable", message: "recommendation service unavailable" };
}

/** Logs why a search failed and returns what the client is told. */
export function describeRecommendationFailure(logger: RecommendationRouteDeps["logger"]) {
  return (error: unknown): SearchJobFailure => {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
    // The response only carries a generic code; without this line a failed
    // request leaves no trace of why (seen as a silent 502 in #241).
    const logError = logger?.error ?? ((obj) => writeStructuredLog("error", obj));
    logError({
      component: "recommendations",
      event: "recommendation_failed",
      code: code || null,
      error: error instanceof Error ? error.message : String(error),
    });
    return recommendationFailure(error, code);
  };
}

/** A search's job is its user's; an install without accounts has one anonymous user. */
const ownerOf = (req: Request): string => req.userId ?? "";

const jobNotFound = (res: Response) => sendError(res, 404, "search_job_not_found", "search job not found");

/** Where to resume: the last event the client saw, from `Last-Event-ID` or `?after=`. */
function resumeAfter(req: Request): number {
  const raw = req.headers["last-event-id"] ?? req.query.after;
  const after = Number(typeof raw === "string" ? raw : "");
  return Number.isSafeInteger(after) && after > 0 ? after : 0;
}

export function registerRecommendationRoutes(app: Express, deps: RecommendationRouteDeps) {
  const { appVersion, recommendationsLimiter, searchJobLimiter, searchJobs, pipeline, evalWorker, logger } = deps;

  /** Validates the request and starts its search; null once it has answered with a 400. */
  function startSearch(req: Request, res: Response): string | null {
    const validation = validateRecommendationRequest(req.body);
    if (validation.ok === false) {
      sendError(res, 400, "validation_error", validation.error);
      return null;
    }

    if (validation.truncated.length > 0) {
      const logFn = logger?.warn ?? ((obj) => writeStructuredLog("warn", obj));
      logFn({ component: "prompt_safety", event: "prompt_safety_truncate", fields: validation.truncated });
    }

    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : null;
    const userId = req.userId;
    const work: SearchJobWork = async ({ emit, signal }) => {
      if (!pipeline) throw new Error("recommendation pipeline is not configured");
      const pipelineResult = await pipeline.recommend({
        query: validation.query,
        mode: validation.mode,
        selectedArtistIds: validation.selectedArtistIds,
        priorityContext: validation.priorityContext,
        messages: validation.messages,
        userId,
        obscurityTarget: validation.obscurityTarget,
        conversationId: validation.conversationId,
      }, {
        signal,
        onProgress: (progress) => emit({ type: "progress", progress }),
        onReply: (text) => emit({ type: "reply", text }),
      });

      const { pipelineDiagnostics, ...publicMeta } = (pipelineResult.meta ?? {}) as Record<string, unknown>;
      // Every batch gets an id: feedback refers to it, and eval (when enabled)
      // records the batch under the same id. An answer in words is no batch.
      const eventId = publicMeta.turn === "answer" ? undefined : randomUUID();
      if (evalWorker && eventId) {
        void evalWorker.processEvent({
          eventId,
          query: validation.query,
          mode: validation.mode,
          sessionId,
          userId,
          obscurityTarget: validation.obscurityTarget ?? null,
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

      // EU AI Act Art. 50(2): layered provenance for the generated prose. The
      // model id arrives with the pipeline's public meta as `model`.
      const provenance = {
        aiGenerated: true,
        generatedAt: new Date().toISOString(),
        pipelineVersion: appVersion,
      };

      return {
        recommendations: pipelineResult.recommendations,
        assistantReply: pipelineResult.assistantReply ?? "",
        meta: { ...publicMeta, ...provenance, ...(eventId ? { eventId } : {}) },
      };
    };
    return searchJobs.start(ownerOf(req), work);
  }

  // A search as a job (ADR 0006): starting it answers at once with its id. The
  // search runs on whether or not anyone follows it, so a phone that sleeps
  // and comes back finds its answer.
  app.post("/recommendations/jobs", recommendationsLimiter, (req, res) => {
    const jobId = startSearch(req, res);
    if (!jobId) return;
    res.setHeader("location", `/recommendations/jobs/${jobId}`);
    return res.status(202).json({ jobId });
  });

  // Asked for a stream: the events so far after the one given, then the live
  // ones, until the end. Otherwise where the job stands, for a client that polls.
  app.get("/recommendations/jobs/:id", searchJobLimiter, (req, res) => {
    const id = String(req.params.id);
    const owner = ownerOf(req);
    if (!wantsEventStream(req)) {
      const job = searchJobs.get(id, owner);
      if (!job) return jobNotFound(res);
      const state: SearchJobState = { jobId: id, ...job };
      return res.status(200).json(state);
    }

    if (!searchJobs.get(id, owner)) return jobNotFound(res);
    const stream = openAnswerStream(res);
    let ended = false;
    const unfollow = searchJobs.follow(id, owner, resumeAfter(req), ({ id: eventId, event }) => {
      stream.send(event, eventId);
      if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
        ended = true;
        stream.end();
      }
    });
    // A client that hangs up stops following, never the search.
    if (ended) unfollow?.();
    else res.on("close", () => unfollow?.());
  });

  app.delete("/recommendations/jobs/:id", searchJobLimiter, (req, res) => {
    if (!searchJobs.cancel(String(req.params.id), ownerOf(req))) return jobNotFound(res);
    writeStructuredLog("info", { component: "recommendations", event: "recommendation_cancelled" });
    return res.status(204).end();
  });

  // The older contract, for clients that hold the request open (the eval
  // runner, app versions before ADR 0006): the same job, followed to its end
  // and answered in JSON, or as events when asked. Hanging up does not stop it.
  app.post("/recommendations", recommendationsLimiter, (req, res) => {
    const jobId = startSearch(req, res);
    if (!jobId) return;
    const stream = answerStreamFor(req, res);
    const unfollow = searchJobs.follow(jobId, ownerOf(req), 0, ({ event }) => {
      if (event.type === "progress" || event.type === "reply") {
        stream?.send(event);
        return;
      }
      if (stream?.isOpen()) {
        stream.send(event);
        return stream.end();
      }
      if (event.type === "done") return res.status(200).json(event.response);
      if (event.type === "error") return sendError(res, event.status, event.error.code, event.error.message);
      return sendError(res, 409, "search_cancelled", "the search was stopped");
    });
    res.on("close", () => unfollow?.());
  });
}
