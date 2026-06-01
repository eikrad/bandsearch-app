import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Express, Request, Response, NextFunction } from "express";
import { sendError } from "../http/errors.js";
import type { EvalRepository, FeedbackInput } from "./evalRepository.js";
import { validateFeedbackType } from "../../../../shared/schemas/src/contracts.js";
import { aggregateMetrics, computeDelta } from "./evalAggregator.js";
import type { AggregatedMetrics } from "./evalAggregator.js";

export type EvalRouteContext = {
  evalRepository: EvalRepository;
  evalDashboardEnabled: boolean;
  evalDashboardPassword?: string;
};

export function registerEvalRoutes(app: Express, ctx: EvalRouteContext) {
  const { evalRepository, evalDashboardEnabled, evalDashboardPassword } = ctx;

  const dashboardHtml = evalDashboardEnabled
    ? readFileSync(join(__dirname, "dashboard", "index.html"), "utf8")
    : null;

  // Gate all /eval/* routes — returns 404 when the dashboard is disabled.
  app.use("/eval", (_req: Request, res: Response, next: NextFunction) => {
    if (!evalDashboardEnabled) return sendError(res, 404, "not_found", "route not found");
    next();
  });

  app.get("/eval/events", async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const events = await evalRepository.listEvents(isNaN(limit) ? 50 : limit);
    const allScores = await evalRepository.listBandEvalScoresByEventIds(events.map((e) => e.id));
    const scoresByEventId = new Map<string, typeof allScores>();
    for (const score of allScores) {
      const arr = scoresByEventId.get(score.eventId) ?? [];
      arr.push(score);
      scoresByEventId.set(score.eventId, arr);
    }
    const eventsWithScores = events.map((event) => ({ ...event, bandScores: scoresByEventId.get(event.id) ?? [] }));
    return res.status(200).json({ events: eventsWithScores });
  });

  app.get("/eval/metrics", async (_req, res) => {
    const [events, latestBaseline] = await Promise.all([
      evalRepository.listEvents(200),
      evalRepository.getLatestBaseline(),
    ]);
    const allScores = await evalRepository.listBandEvalScoresByEventIds(events.map((e) => e.id));

    const current: AggregatedMetrics = aggregateMetrics(events, allScores);

    if (!latestBaseline) {
      return res.status(200).json({ current, baseline: null, delta: null });
    }

    const baselineMetrics: AggregatedMetrics = JSON.parse(latestBaseline.metricsJson);
    const delta = computeDelta(current, baselineMetrics);

    return res.status(200).json({
      current,
      baseline: { id: latestBaseline.id, label: latestBaseline.label, createdAt: latestBaseline.createdAt, metrics: baselineMetrics },
      delta,
    });
  });

  app.post("/eval/baseline", async (req, res) => {
    const { label } = req.body ?? {};
    if (!label || typeof label !== "string" || label.trim().length === 0) {
      return sendError(res, 400, "validation_error", "label is required");
    }
    const events = await evalRepository.listEvents(200);
    const allScores = await evalRepository.listBandEvalScoresByEventIds(events.map((e) => e.id));
    const metrics = aggregateMetrics(events, allScores);
    const baseline = await evalRepository.createBaseline(label.trim(), metrics);
    return res.status(201).json({ id: baseline.id, label: baseline.label, createdAt: baseline.createdAt });
  });

  app.get("/eval/baselines", async (_req, res) => {
    const baselines = await evalRepository.listBaselines();
    return res.status(200).json({
      baselines: baselines.map((b) => ({ id: b.id, label: b.label, createdAt: b.createdAt })),
    });
  });

  app.post("/eval/feedback", async (req, res) => {
    const { eventId, feedbackType, userId } = req.body ?? {};
    if (!eventId || typeof eventId !== "string") {
      return sendError(res, 400, "validation_error", "eventId is required");
    }
    const validatedType = validateFeedbackType(feedbackType);
    if (!validatedType) {
      return sendError(res, 400, "validation_error", "feedbackType must be one of: good, too_mainstream, wrong_direction");
    }
    const input: FeedbackInput = {
      eventId,
      feedbackType: validatedType,
      userId: typeof userId === "string" ? userId : undefined,
    };
    await evalRepository.logFeedback(input);
    return res.status(200).json({ ok: true });
  });

  app.get("/eval/dashboard", (req, res) => {
    if (evalDashboardPassword) {
      const reject401 = () => {
        res.setHeader("WWW-Authenticate", 'Basic realm="eval"');
        return res.status(401).send("Unauthorized");
      };
      const authHeader = (req.headers["authorization"] as string | undefined) ?? "";
      if (!authHeader.startsWith("Basic ")) return reject401();
      const credentials = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
      const colonIdx = credentials.indexOf(":");
      const suppliedPassword = colonIdx >= 0 ? credentials.slice(colonIdx + 1) : credentials;
      if (suppliedPassword !== evalDashboardPassword) return reject401();
    }

    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src 'self'",
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(dashboardHtml);
  });
}
