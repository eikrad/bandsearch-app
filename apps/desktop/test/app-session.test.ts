import test from "node:test";
import assert from "node:assert/strict";
import { createAppSession, type AppSessionDeps } from "../src/appSession.js";
import type { AuthStatus } from "../src/authApiClient.js";

type Status = AuthStatus;

const ACCOUNTS_ON = (userCount = 2, inviteRequired = false): Status =>
  ({ reachable: true, enabled: true, userCount, inviteRequired });
const AUTH_OFF: Status = { reachable: true, enabled: false, userCount: 0, inviteRequired: false };
const DOWN: Status = { reachable: false, reason: "http_502" };

/**
 * A session over a scripted `/auth/status`, an in-memory token and a router
 * that records where it was sent. Each status call takes the next scripted
 * answer; the last one repeats.
 */
function harness({
  statuses = [ACCOUNTS_ON()],
  token = null as string | null,
  route = "home",
  auth = {} as Partial<AppSessionDeps["auth"]>,
} = {}) {
  let currentRoute = route;
  let storedToken = token;
  let statusCalls = 0;
  const navigations: string[] = [];
  const session = createAppSession({
    auth: {
      getAuthStatus: async () => statuses[Math.min(statusCalls++, statuses.length - 1)],
      login: async () => ({ ok: true, token: "t-login", user: { id: "u1", email: "a@b.c", displayName: "A", createdAt: "" } }),
      register: async () => ({ ok: true, token: "t-reg", recoveryCode: "RC", user: { id: "u1", email: "a@b.c", displayName: "A", createdAt: "" } }),
      resetPassword: async () => ({ ok: true, newRecoveryCode: "RC2" }),
      deleteAccount: async () => ({ ok: true, erased: {} }),
      ...auth,
    },
    token: {
      get: () => storedToken,
      set: (t) => { storedToken = t; },
      clear: () => { storedToken = null; },
    },
    router: {
      getRoute: () => currentRoute,
      navigate: (r) => { currentRoute = r; navigations.push(r); },
    },
    sleep: async () => {},
    now: () => 0,
  });
  return {
    session,
    navigations,
    route: () => currentRoute,
    token: () => storedToken,
    statusCalls: () => statusCalls,
  };
}

// --- Startup -----------------------------------------------------------------

test("a first launch offers Welcome without asking the API anything", async () => {
  const h = harness();

  await h.session.start({ offerWelcome: true });

  assert.equal(h.route(), "welcome");
  assert.equal(h.statusCalls(), 0);
});

test("startup sends a user without a token to login when accounts are on", async () => {
  const h = harness({ statuses: [ACCOUNTS_ON()] });

  await h.session.start({ offerWelcome: false });

  assert.equal(h.route(), "login");
  assert.equal(h.statusCalls(), 1, "a healthy start costs exactly one status check");
});

test("startup keeps a deep link when the gate lets the user in", async () => {
  const h = harness({ statuses: [AUTH_OFF], route: "saved" });

  await h.session.start({ offerWelcome: false });

  assert.equal(h.route(), "saved");
  assert.deepEqual(h.navigations, [], "no navigation, so no needless render");
});

test("startup does not leave a let-in user on an auth screen", async () => {
  const h = harness({ statuses: [AUTH_OFF], route: "login" });

  await h.session.start({ offerWelcome: false });

  assert.equal(h.route(), "home");
});

test("a cold API puts the user on Connecting, which keeps trying once on screen", async () => {
  const h = harness({ statuses: [DOWN, DOWN, DOWN, ACCOUNTS_ON()] });
  const attempts: unknown[] = [];
  h.session.subscribe(() => attempts.push(h.session.connectingViewProps()));

  await h.session.start({ offerWelcome: false });
  assert.equal(h.route(), "connecting");
  assert.deepEqual(h.session.connectingViewProps(), { state: "waiting", attempt: 1 });

  await h.session.connectIfWaiting();

  assert.equal(h.route(), "login");
  assert.ok(attempts.length >= 2, "each attempt is shown");
});

test("an API that never answers ends on the failed Connecting state", async () => {
  // Each attempt advances the clock 40 s, so the 90 s budget runs out on the third.
  let clock = 0;
  const session = createAppSession({
    auth: { getAuthStatus: async () => { clock += 40_000; return DOWN; } } as unknown as AppSessionDeps["auth"],
    token: { get: () => null, set: () => {}, clear: () => {} },
    router: { getRoute: () => "connecting", navigate: () => {} },
    sleep: async () => {},
    now: () => clock,
  });

  await session.connectIfWaiting();

  assert.deepEqual(session.connectingViewProps(), { state: "failed" });
});

test("Retry from the failed state starts over and routes on when the API wakes", async () => {
  const h = harness({ statuses: [DOWN, ACCOUNTS_ON()], route: "connecting" });

  await h.session.retry();

  assert.equal(h.route(), "login");
});

test("connectIfWaiting does nothing off the Connecting screen", async () => {
  const h = harness({ route: "home" });

  await h.session.connectIfWaiting();

  assert.equal(h.statusCalls(), 0);
});

// --- Entering the app (#313 bug 1) -------------------------------------------

test("leaving Welcome on an accounts deployment goes to login, not into the chat", async () => {
  const h = harness({ statuses: [ACCOUNTS_ON()] });
  await h.session.start({ offerWelcome: true });

  await h.session.enterApp();

  assert.equal(h.route(), "login");
});

test("leaving Welcome while the API is cold shows Connecting and keeps trying", async () => {
  const h = harness({ statuses: [DOWN, AUTH_OFF] });
  await h.session.start({ offerWelcome: true });

  await h.session.enterApp();

  assert.deepEqual(h.navigations, ["welcome", "connecting", "home"]);
});

test("once the gate has passed, entering the chat costs no request", async () => {
  const h = harness({ statuses: [AUTH_OFF], route: "settings" });
  await h.session.start({ offerWelcome: false });

  await h.session.enterApp();

  assert.equal(h.route(), "home");
  assert.equal(h.statusCalls(), 1);
});

// --- Account events (#313 bug 2) ---------------------------------------------

test("logging in stores the token and entering the app then lands on the chat", async () => {
  const h = harness({ statuses: [ACCOUNTS_ON()] });
  await h.session.start({ offerWelcome: false });

  await h.session.login("a@b.c", "pw");
  await h.session.enterApp();

  assert.equal(h.token(), "t-login");
  assert.equal(h.route(), "home");
});

test("a refused login throws the API's message and keeps no token", async () => {
  const h = harness({ auth: { login: async () => ({ ok: false, error: "invalid credentials" }) } });

  await assert.rejects(h.session.login("a@b.c", "nope"), /invalid credentials/);

  assert.equal(h.token(), null);
});

test("registering the first account makes Settings offer export and deletion", async () => {
  const h = harness({ statuses: [ACCOUNTS_ON(0), ACCOUNTS_ON(1)] });
  await h.session.start({ offerWelcome: false });
  assert.equal(h.route(), "register");
  assert.equal(h.session.accountsEnabled(), false);

  const { recoveryCode } = await h.session.register("a@b.c", "A", "pw");
  await h.session.enterApp();

  assert.equal(recoveryCode, "RC");
  assert.equal(h.session.accountsEnabled(), true, "the delete zone must not wait for a restart");
  assert.equal(h.route(), "home");
});

test("deleting an account on a closed deployment with other users goes to login", async () => {
  const h = harness({ statuses: [ACCOUNTS_ON(3, true), ACCOUNTS_ON(2, true)], token: "t" });
  await h.session.start({ offerWelcome: false });

  const result = await h.session.deleteAccount("pw");
  await h.session.enterApp();

  assert.deepEqual(result, { ok: true });
  assert.equal(h.token(), null);
  assert.equal(h.route(), "login", "Register would need an invite the user no longer has");
});

test("deleting the only account of a personal install goes to register", async () => {
  const h = harness({ statuses: [ACCOUNTS_ON(1), ACCOUNTS_ON(0)], token: "t" });
  await h.session.start({ offerWelcome: false });

  await h.session.deleteAccount("pw");
  await h.session.enterApp();

  assert.equal(h.route(), "register");
});

test("a refused deletion reports the error and keeps the user signed in", async () => {
  const h = harness({ token: "t", auth: { deleteAccount: async () => ({ ok: false, error: "wrong password" }) } });

  const result = await h.session.deleteAccount("bad");

  assert.deepEqual(result, { ok: false, error: "wrong password" });
  assert.equal(h.token(), "t");
});

test("resetting a password signs the user out and returns the new recovery code", async () => {
  const h = harness({ token: "t" });

  const { newRecoveryCode } = await h.session.resetPassword("a@b.c", "RC", "new");

  assert.equal(newRecoveryCode, "RC2");
  assert.equal(h.token(), null);
});

test("a rejected token signs out, goes to login, and the gate is asked again", async () => {
  const h = harness({ statuses: [AUTH_OFF, ACCOUNTS_ON()], token: "t" });
  await h.session.start({ offerWelcome: false });

  h.session.unauthorized();
  assert.equal(h.route(), "login");
  assert.equal(h.token(), null);

  await h.session.enterApp();
  assert.equal(h.statusCalls(), 2, "a signed-out user does not count as let in");
});

test("the register screen asks for an invite on a closed deployment", async () => {
  const h = harness({ statuses: [ACCOUNTS_ON(0, true)] });

  await h.session.start({ offerWelcome: false });

  assert.equal(h.session.inviteRequired(), true);
  assert.equal(h.route(), "login", "an empty closed deployment is no invitation to register");
});
