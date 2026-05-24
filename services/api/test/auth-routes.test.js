const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");
const { createInMemoryUserRepository } = require("../src/auth/userRepository");
const { createPreferenceRepository } = require("../src/preferences/preferenceRepository");

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

function freshApp(userRepository = createInMemoryUserRepository()) {
  return createApp({
    userRepository,
    preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }),
    runtimeConfig: { jwtSecret: JWT_SECRET },
  });
}

async function req(app, method, path, payload, token) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const headers = { "content-type": "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return { status: response.status, data: await response.json() };
  } finally {
    server.close();
  }
}

// --- /auth/register ---

test("POST /auth/register creates user and returns token + recoveryCode", async () => {
  const app = freshApp();
  const r = await req(app, "POST", "/auth/register", { email: "a@x.com", displayName: "A", password: "pw" });
  assert.equal(r.status, 201);
  assert.ok(r.data.token);
  assert.ok(r.data.recoveryCode);
  assert.equal(r.data.user.email, "a@x.com");
});

test("POST /auth/register returns 400 for duplicate email", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  await req(app, "POST", "/auth/register", { email: "dup@x.com", displayName: "D", password: "pw" });
  const r = await req(app, "POST", "/auth/register", { email: "dup@x.com", displayName: "D2", password: "pw2" });
  assert.equal(r.status, 400);
});

test("POST /auth/register returns 400 when email is missing", async () => {
  const r = await req(freshApp(), "POST", "/auth/register", { displayName: "X", password: "pw" });
  assert.equal(r.status, 400);
});

// --- /auth/login ---

test("POST /auth/login returns token for valid credentials", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  await req(app, "POST", "/auth/register", { email: "b@x.com", displayName: "B", password: "correct" });
  const r = await req(app, "POST", "/auth/login", { email: "b@x.com", password: "correct" });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
});

test("POST /auth/login returns 401 for wrong password", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  await req(app, "POST", "/auth/register", { email: "c@x.com", displayName: "C", password: "right" });
  const r = await req(app, "POST", "/auth/login", { email: "c@x.com", password: "wrong" });
  assert.equal(r.status, 401);
});

test("POST /auth/login returns 401 for unknown email", async () => {
  const r = await req(freshApp(), "POST", "/auth/login", { email: "nobody@x.com", password: "pw" });
  assert.equal(r.status, 401);
});

// --- /auth/reset-password ---

test("POST /auth/reset-password succeeds with valid recovery code", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  const reg = await req(app, "POST", "/auth/register", { email: "d@x.com", displayName: "D", password: "old" });
  const r = await req(app, "POST", "/auth/reset-password", {
    email: "d@x.com",
    recoveryCode: reg.data.recoveryCode,
    newPassword: "new",
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.newRecoveryCode);
});

test("POST /auth/reset-password returns 400 for wrong recovery code", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  await req(app, "POST", "/auth/register", { email: "e@x.com", displayName: "E", password: "pw" });
  const r = await req(app, "POST", "/auth/reset-password", { email: "e@x.com", recoveryCode: "wrong", newPassword: "new" });
  assert.equal(r.status, 400);
});

// --- auth middleware ---

test("protected route passes through when no users registered (0-user bypass)", async () => {
  const r = await req(freshApp(), "GET", "/preferences");
  assert.equal(r.status, 200);
});

test("protected route auto-attaches single user without token (single-user bypass)", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  await req(app, "POST", "/auth/register", { email: "f@x.com", displayName: "F", password: "pw" });
  const r = await req(app, "GET", "/preferences");
  assert.equal(r.status, 200);
});

test("protected route accepts valid Bearer token", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  const reg = await req(app, "POST", "/auth/register", { email: "g@x.com", displayName: "G", password: "pw" });
  const r = await req(app, "GET", "/preferences", undefined, reg.data.token);
  assert.equal(r.status, 200);
});

test("protected route returns 401 when multiple users and no token", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  await req(app, "POST", "/auth/register", { email: "h@x.com", displayName: "H", password: "pw" });
  await req(app, "POST", "/auth/register", { email: "i@x.com", displayName: "I", password: "pw2" });
  const r = await req(app, "GET", "/preferences");
  assert.equal(r.status, 401);
});

test("protected route returns 401 for invalid token", async () => {
  const ur = createInMemoryUserRepository();
  const app = freshApp(ur);
  await req(app, "POST", "/auth/register", { email: "j@x.com", displayName: "J", password: "pw" });
  const r = await req(app, "GET", "/preferences", undefined, "bad.token.here");
  assert.equal(r.status, 401);
});

test("public routes remain accessible without token", async () => {
  const r = await req(freshApp(), "GET", "/health");
  assert.equal(r.status, 200);
});
