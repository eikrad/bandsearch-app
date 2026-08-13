import test from "node:test";
import assert from "node:assert/strict";
import { createAuthAwareFetch } from "../src/authAwareFetch.js";

function makeResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("createAuthAwareFetch passes through 200 responses without calling onInvalidToken", async () => {
  const mockFetch: typeof fetch = async () => makeResponse(200, { ok: true });
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  const res = await f("http://localhost/api");
  assert.equal(res.status, 200);
  assert.equal(called, false);
});

test("createAuthAwareFetch calls onInvalidToken on 401 with invalid token message", async () => {
  const body = { error: { code: "unauthorized", message: "invalid token" } };
  const mockFetch: typeof fetch = async () => makeResponse(401, body);
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  const res = await f("http://localhost/api");
  assert.equal(res.status, 401);
  assert.equal(called, true);
});

test("createAuthAwareFetch does NOT call onInvalidToken on 401 with authentication required message", async () => {
  const body = { error: { code: "unauthorized", message: "authentication required" } };
  const mockFetch: typeof fetch = async () => makeResponse(401, body);
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  await f("http://localhost/api");
  assert.equal(called, false);
});

test("createAuthAwareFetch does NOT call onInvalidToken on 403 responses", async () => {
  const mockFetch: typeof fetch = async () =>
    makeResponse(403, { error: { code: "forbidden", message: "forbidden" } });
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  await f("http://localhost/api");
  assert.equal(called, false);
});

test("createAuthAwareFetch still returns the original response body after 401 check", async () => {
  const body = { error: { code: "unauthorized", message: "invalid token" } };
  const mockFetch: typeof fetch = async () => makeResponse(401, body);
  const f = createAuthAwareFetch(mockFetch, () => {});
  const res = await f("http://localhost/api");
  const data: unknown = await res.json();
  assert.ok(typeof data === "object" && data !== null && "error" in data);
  assert.ok(
    typeof data.error === "object" &&
      data.error !== null &&
      "message" in data.error &&
      typeof data.error.message === "string",
  );
  assert.equal(data.error.message, "invalid token");
});

test("createAuthAwareFetch does not crash when 401 body is not JSON", async () => {
  const mockFetch: typeof fetch = async () => new Response("Unauthorized", { status: 401 });
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  const res = await f("http://localhost/api");
  assert.equal(res.status, 401);
  assert.equal(called, false);
});
