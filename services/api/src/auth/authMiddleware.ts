import type { Request, Response, NextFunction } from "express";
import { sendError } from "../http/errors";
import type { AuthService } from "./authService";
import type { UserRepository } from "./userRepository";

export type AuthMode = "progressive" | "enforced";

/**
 * progressive: a fresh install is open and a single-user install forgives a
 * missing or stale token (see ADR 0003).
 * enforced: every request needs a valid token for an existing, active user.
 */
export function createAuthMiddleware(
  authService: AuthService,
  userRepository: UserRepository,
  { mode = "progressive" }: { mode?: AuthMode } = {},
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  async function enforce(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      sendError(res, 401, "unauthorized", "authentication required");
      return;
    }
    const result = authService.verifyToken(authHeader.slice(7));
    if (!result.ok) {
      sendError(res, 401, "unauthorized", "invalid token");
      return;
    }
    // A signature proves the token was once issued, not that the account still
    // exists or is still allowed in. Checked on every request so that disabling
    // a user takes effect now, not when their 30-day token runs out.
    const user = await userRepository.findById(result.userId);
    if (!user || user.disabledAt) {
      sendError(res, 401, "unauthorized", "invalid token");
      return;
    }
    req.userId = user.id;
    next();
  }

  async function progressive(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers["authorization"];
    let invalidToken = false;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const result = authService.verifyToken(token);
      if (result.ok) {
        req.userId = result.userId;
        next();
        return;
      }
      // Invalid/stale token: fall through to user-count check.
      // Single-user installs auto-recover; multi-user installs still reject.
      invalidToken = true;
    }

    const count = await userRepository.countUsers();

    if (count === 0) {
      next();
      return;
    }

    if (count === 1) {
      const user = await userRepository.getFirstUser();
      req.userId = user!.id;
      next();
      return;
    }

    sendError(res, 401, "unauthorized", invalidToken ? "invalid token" : "authentication required");
  }

  return mode === "enforced" ? enforce : progressive;
}
