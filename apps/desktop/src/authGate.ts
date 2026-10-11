import type { AuthStatus } from "./authApiClient.js";

/**
 * Where startup should send the user.
 *
 * `unavailable` is deliberately its own outcome rather than being folded into
 * `login`: not knowing whether auth is required is a different situation from
 * knowing it is, and the caller renders it differently — a login form the API
 * cannot serve is no more useful than the pass-through this replaces.
 */
export type AuthRoute = "register" | "login" | "app" | "unavailable";

/**
 * Decides the startup route from what `/auth/status` said and whether a token is
 * already held.
 *
 * Kept pure and separate from the router so the rule is testable on its own —
 * the same shape as `firstRunOnboarding` and `updateNotification`.
 */
export function decideAuthRoute({
  status,
  hasToken,
}: {
  status: AuthStatus;
  hasToken: boolean;
}): AuthRoute {
  // No answer means no decision. Treating silence as "auth is off" is exactly
  // the defect this replaces (#155).
  if (!status.reachable) return "unavailable";

  if (!status.enabled) return "app";
  // On a closed deployment registering needs an invite, so an empty instance is
  // not an invitation to register: login is where an invitee finds the link to it.
  if (status.userCount === 0 && !status.inviteRequired) return "register";
  return hasToken ? "app" : "login";
}
