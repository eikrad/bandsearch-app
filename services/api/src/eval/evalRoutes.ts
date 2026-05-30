import type { Express } from "express";
import { sendError } from "../http/errors.js";
import type { EvalRepository } from "./evalRepository.js";

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
    return res.status(200).json({ events });
  });
}
