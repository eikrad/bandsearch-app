import test from "node:test";
import assert from "node:assert/strict";

import { createAuthApiClient } from "../src/authApiClient.js";
import { errorResponse, jsonResponse } from "./helpers/fakeResponse.js";

type FetchCall = {
  url: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

/**
 * Records what the client asked for and replies with a scripted queue.
 *
 * One response per call, in order — every test here makes exactly one request,
 * so a queue keeps the setup shorter than a URL-matching double.
 */
function fakeFetch(responses: Response[]) {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected fetch call to ${url}`);
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const user = { id: "u1", email: "a@b.c", displayName: "A", createdAt: "2026-01-01T00:00:00.000Z" };

// ------------------------------------------------------------- base URL

test("createAuthApiClient strips a trailing slash from the base URL", async () => {
  const { fetchImpl, calls } = fakeFetch([jsonResponse({ enabled: true, userCount: 2 })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001/", fetchImpl });

  await client.getAuthStatus();

  assert.equal(calls[0].url, "http://localhost:3001/auth/status");
});

// ----------------------------------------------------------- auth status

test("getAuthStatus returns the reported enabled flag and user count", async () => {
  const { fetchImpl, calls } = fakeFetch([jsonResponse({ enabled: true, userCount: 3 })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  assert.deepEqual(await client.getAuthStatus(), { reachable: true, enabled: true, userCount: 3 });
  assert.equal(calls[0].method, "GET");
});

test("getAuthStatus coerces a missing user count to zero", async () => {
  const { fetchImpl } = fakeFetch([jsonResponse({ enabled: true })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  assert.deepEqual(await client.getAuthStatus(), { reachable: true, enabled: true, userCount: 0 });
});

test("a 5xx means the API could not answer, not that auth is disabled", async () => {
  const { fetchImpl } = fakeFetch([errorResponse(500, { error: { message: "boom" } })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  // Render answers 5xx while a spun-down instance wakes. Reporting that as
  // "auth is disabled" put the user into pass-through mode during a cold start.
  const status = await client.getAuthStatus();

  assert.equal(status.reachable, false);
  assert.equal(status.reachable === false && status.reason, "http_500");
});

test("a failed request means the API could not answer, not that auth is disabled", async () => {
  const fetchImpl = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const status = await client.getAuthStatus();

  assert.equal(status.reachable, false);
  assert.equal(status.reachable === false && status.reason, "network_error");
});

test("auth being genuinely disabled is reported as a reachable answer", async () => {
  // The single-user bypass: the server is up and says no auth is needed. This
  // must stay distinguishable from the two cases above, which is the whole point.
  const { fetchImpl } = fakeFetch([jsonResponse({ enabled: false, userCount: 0 })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  assert.deepEqual(await client.getAuthStatus(), { reachable: true, enabled: false, userCount: 0 });
});

// -------------------------------------------------------------- register

test("register posts the credentials and returns the token and recovery code", async () => {
  const { fetchImpl, calls } = fakeFetch([
    jsonResponse({ user, token: "tok-1", recoveryCode: "rec-1" }),
  ]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.register({ email: "a@b.c", displayName: "A", password: "pw" });

  assert.equal(calls[0].url, "http://localhost:3001/auth/register");
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { email: "a@b.c", displayName: "A", password: "pw" });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.token, "tok-1");
  assert.equal(result.ok === true && result.recoveryCode, "rec-1");
  assert.deepEqual(result.ok === true && result.user, user);
});

test("register surfaces the API error message", async () => {
  const { fetchImpl } = fakeFetch([
    errorResponse(403, { error: { message: "registration is currently closed" } }),
  ]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.register({ email: "a@b.c", displayName: "A", password: "pw" });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "registration is currently closed");
});

test("register falls back to a generic message when the API sends no message", async () => {
  const { fetchImpl } = fakeFetch([errorResponse(500, {})]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.register({ email: "a@b.c", displayName: "A", password: "pw" });

  assert.equal(result.ok === false && result.error, "registration failed");
});

// ----------------------------------------------------------------- login

test("login posts the credentials and returns the token", async () => {
  const { fetchImpl, calls } = fakeFetch([jsonResponse({ user, token: "tok-2" })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.login({ email: "a@b.c", password: "pw" });

  assert.equal(calls[0].url, "http://localhost:3001/auth/login");
  assert.deepEqual(calls[0].body, { email: "a@b.c", password: "pw" });
  assert.equal(result.ok === true && result.token, "tok-2");
});

test("login surfaces the API error message", async () => {
  const { fetchImpl } = fakeFetch([errorResponse(401, { error: { message: "invalid credentials" } })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.login({ email: "a@b.c", password: "wrong" });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "invalid credentials");
});

test("login falls back to a generic message when the API sends no message", async () => {
  const { fetchImpl } = fakeFetch([errorResponse(401, {})]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.login({ email: "a@b.c", password: "pw" });

  assert.equal(result.ok === false && result.error, "login failed");
});

// -------------------------------------------------------- reset password

test("resetPassword posts the recovery code and returns the new one", async () => {
  const { fetchImpl, calls } = fakeFetch([jsonResponse({ newRecoveryCode: "rec-2" })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.resetPassword({
    email: "a@b.c",
    recoveryCode: "rec-1",
    newPassword: "pw2",
  });

  assert.equal(calls[0].url, "http://localhost:3001/auth/reset-password");
  assert.deepEqual(calls[0].body, { email: "a@b.c", recoveryCode: "rec-1", newPassword: "pw2" });
  assert.equal(result.ok === true && result.newRecoveryCode, "rec-2");
});

test("resetPassword surfaces the API error message", async () => {
  const { fetchImpl } = fakeFetch([errorResponse(400, { error: { message: "invalid recovery code" } })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.resetPassword({ email: "a@b.c", recoveryCode: "no", newPassword: "pw2" });

  assert.equal(result.ok === false && result.error, "invalid recovery code");
});

test("resetPassword falls back to a generic message when the API sends no message", async () => {
  const { fetchImpl } = fakeFetch([errorResponse(400, {})]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.resetPassword({ email: "a@b.c", recoveryCode: "no", newPassword: "pw2" });

  assert.equal(result.ok === false && result.error, "reset failed");
});

// ------------------------------------------------------------ delete account

test("deleting an account sends the password to the delete endpoint", async () => {
  const { fetchImpl, calls } = fakeFetch([jsonResponse({ ok: true, erased: { users: 1 } })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.deleteAccount({ password: "hunter2" });

  assert.equal(result.ok, true);
  assert.match(calls[0].url, /\/account\/delete$/);
  assert.deepEqual(calls[0].body, { password: "hunter2" });
});

test("deleting an account is authenticated", async () => {
  const { fetchImpl, calls } = fakeFetch([jsonResponse({ ok: true, erased: {} })]);
  const client = createAuthApiClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl,
    getToken: () => "tok-123",
  });

  await client.deleteAccount({ password: "hunter2" });

  assert.equal(calls[0].headers?.authorization, "Bearer tok-123", "the caller is identified by their token");
});

test("a failed deletion surfaces the reason to the user", async () => {
  const { fetchImpl } = fakeFetch([
    errorResponse(401, { error: { message: "invalid credentials" } }),
  ]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  const result = await client.deleteAccount({ password: "wrong" });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "invalid credentials");
});
