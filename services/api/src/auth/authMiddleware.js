const { sendError } = require("../http/errors");

function createAuthMiddleware(authService, userRepository) {
  return async function authenticateRequest(req, res, next) {
    const authHeader = req.headers["authorization"];

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const result = authService.verifyToken(token);
      if (!result.ok) return sendError(res, 401, "unauthorized", "invalid token");
      req.userId = result.userId;
      return next();
    }

    const count = await userRepository.countUsers();

    if (count === 0) {
      return next();
    }

    if (count === 1) {
      const user = await userRepository.getFirstUser();
      req.userId = user.id;
      return next();
    }

    return sendError(res, 401, "unauthorized", "authentication required");
  };
}

module.exports = { createAuthMiddleware };
