const test = require("node:test");
const assert = require("node:assert/strict");

const { createAuthAwareFetch } = require("../src/authAwareFetch");

function makeResponse(status, body) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("createAuthAwareFetch passes through 200 responses without calling onInvalidToken", async () => {
  const mockFetch = async () => makeResponse(200, { ok: true });
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  const res = await f("http://localhost/api");
  assert.equal(res.status, 200);
  assert.equal(called, false);
});

test("createAuthAwareFetch calls onInvalidToken on 401 with invalid token message", async () => {
  const body = { error: { code: "unauthorized", message: "invalid token" } };
  const mockFetch = async () => makeResponse(401, body);
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  const res = await f("http://localhost/api");
  assert.equal(res.status, 401);
  assert.equal(called, true);
});

test("createAuthAwareFetch does NOT call onInvalidToken on 401 with authentication required message", async () => {
  const body = { error: { code: "unauthorized", message: "authentication required" } };
  const mockFetch = async () => makeResponse(401, body);
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  await f("http://localhost/api");
  assert.equal(called, false);
});

test("createAuthAwareFetch does NOT call onInvalidToken on 403 responses", async () => {
  const mockFetch = async () => makeResponse(403, { error: { code: "forbidden", message: "forbidden" } });
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  await f("http://localhost/api");
  assert.equal(called, false);
});

test("createAuthAwareFetch still returns the original response body after 401 check", async () => {
  const body = { error: { code: "unauthorized", message: "invalid token" } };
  const mockFetch = async () => makeResponse(401, body);
  const f = createAuthAwareFetch(mockFetch, () => {});
  const res = await f("http://localhost/api");
  const data = await res.json();
  assert.equal(data.error.message, "invalid token");
});

test("createAuthAwareFetch does not crash when 401 body is not JSON", async () => {
  const mockFetch = async () => new Response("Unauthorized", { status: 401 });
  let called = false;
  const f = createAuthAwareFetch(mockFetch, () => { called = true; });
  const res = await f("http://localhost/api");
  assert.equal(res.status, 401);
  assert.equal(called, false);
});
