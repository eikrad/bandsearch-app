import test from "node:test";
import assert from "node:assert/strict";

import { createAuthApiClient } from "../src/authApiClient.js";
import { errorResponse, jsonResponse } from "./helpers/fakeResponse.js";

type FetchCall = { url: string; method?: string; body?: unknown };

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

  assert.deepEqual(await client.getAuthStatus(), { enabled: true, userCount: 3 });
  assert.equal(calls[0].method, "GET");
});

test("getAuthStatus coerces a missing user count to zero", async () => {
  const { fetchImpl } = fakeFetch([jsonResponse({ enabled: true })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  assert.deepEqual(await client.getAuthStatus(), { enabled: true, userCount: 0 });
});

test("getAuthStatus reports auth disabled on a non-2xx response", async () => {
  const { fetchImpl } = fakeFetch([errorResponse(500, { error: { message: "boom" } })]);
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  // The desktop client routes on this before it can show anything, so an API
  // that is down must not strand the user on a login screen it cannot satisfy.
  assert.deepEqual(await client.getAuthStatus(), { enabled: false, userCount: 0 });
});

test("getAuthStatus reports auth disabled when the request throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;
  const client = createAuthApiClient({ apiBaseUrl: "http://localhost:3001", fetchImpl });

  assert.deepEqual(await client.getAuthStatus(), { enabled: false, userCount: 0 });
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
