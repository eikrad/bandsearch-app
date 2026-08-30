import test from "node:test";
import assert from "node:assert/strict";

import { decideAuthRoute } from "../src/authGate.js";
import type { AuthStatus } from "../src/authApiClient.js";

const reachable = (enabled: boolean, userCount: number): AuthStatus =>
  ({ reachable: true, enabled, userCount });

const unreachable: AuthStatus = { reachable: false, reason: "http_502" };

test("a first-time user on an empty instance is sent to register", () => {
  assert.equal(decideAuthRoute({ status: reachable(true, 0), hasToken: false }), "register");
});

test("a returning user without a token is sent to login", () => {
  assert.equal(decideAuthRoute({ status: reachable(true, 2), hasToken: false }), "login");
});

test("a user holding a token goes straight into the app", () => {
  assert.equal(decideAuthRoute({ status: reachable(true, 2), hasToken: true }), "app");
});

test("auth genuinely switched off lets the user into the app", () => {
  // The single-user bypass: the server answered and said no auth is required.
  assert.equal(decideAuthRoute({ status: reachable(false, 0), hasToken: false }), "app");
});

test("an unreachable API does not let the user into the app", () => {
  // The defect this module exists to prevent (#155): an unreachable API used to
  // collapse into `{ enabled: false }`, which read as "auth is off" and waved the
  // user through into a chat where every request then failed. Not knowing whether
  // auth is required is its own outcome, never a licence to skip it.
  assert.equal(decideAuthRoute({ status: unreachable, hasToken: false }), "unavailable");
});

test("an unreachable API is unavailable even when a token is held", () => {
  // A token is not proof the server accepts it — it may be expired, or belong to
  // a different instance after an endpoint change.
  assert.equal(decideAuthRoute({ status: unreachable, hasToken: true }), "unavailable");
});
