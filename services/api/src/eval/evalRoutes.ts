import type { Express } from "express";
import { sendError } from "../http/errors.js";
import type { EvalRepository } from "./evalRepository.js";
import { aggregateMetrics, computeDelta } from "./evalAggregator.js";
import type { AggregatedMetrics } from "./evalAggregator.js";

export type EvalRouteContext = {
  evalRepository: EvalRepository;
  evalDashboardEnabled: boolean;
};

export function registerEvalRoutes(app: Express, ctx: EvalRouteContext) {
  const { evalRepository, evalDashboardEnabled } = ctx;

  app.get("/eval/events", async (req, res) => {
    if (!evalDashboardEnabled) {
      return sendError(res, 404, "not_found", "route not found: /eval/events");
    }
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const events = await evalRepository.listEvents(isNaN(limit) ? 50 : limit);
    const eventsWithScores = await Promise.all(
      events.map(async (event) => {
        const bandScores = await evalRepository.listBandEvalScores(event.id);
        return { ...event, bandScores };
      }),
    );
    return res.status(200).json({ events: eventsWithScores });
  });

  app.get("/eval/metrics", async (_req, res) => {
    if (!evalDashboardEnabled) {
      return sendError(res, 404, "not_found", "route not found: /eval/metrics");
    }
    const [events, latestBaseline] = await Promise.all([
      evalRepository.listEvents(200),
      evalRepository.getLatestBaseline(),
    ]);
    const allScores = (
      await Promise.all(events.map((e) => evalRepository.listBandEvalScores(e.id)))
    ).flat();

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
    if (!evalDashboardEnabled) {
      return sendError(res, 404, "not_found", "route not found: /eval/baseline");
    }
    const { label } = req.body ?? {};
    if (!label || typeof label !== "string" || label.trim().length === 0) {
      return sendError(res, 400, "validation_error", "label is required");
    }
    const [events] = await Promise.all([evalRepository.listEvents(200)]);
    const allScores = (
      await Promise.all(events.map((e) => evalRepository.listBandEvalScores(e.id)))
    ).flat();
    const metrics = aggregateMetrics(events, allScores);
    const baseline = await evalRepository.createBaseline(label.trim(), metrics);
    return res.status(201).json({ id: baseline.id, label: baseline.label, createdAt: baseline.createdAt });
  });

  app.get("/eval/baselines", async (_req, res) => {
    if (!evalDashboardEnabled) {
      return sendError(res, 404, "not_found", "route not found: /eval/baselines");
    }
    const baselines = await evalRepository.listBaselines();
    return res.status(200).json({
      baselines: baselines.map((b) => ({ id: b.id, label: b.label, createdAt: b.createdAt })),
    });
  });
}
