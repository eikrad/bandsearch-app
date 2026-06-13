import type { Request, Response, NextFunction } from "express";
import { sendError } from "../http/errors";
import type { AuthService } from "./authService";
import type { UserRepository } from "./userRepository";

export function createAuthMiddleware(
  authService: AuthService,
  userRepository: UserRepository,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async function authenticateRequest(req, res, next) {
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
  };
}
