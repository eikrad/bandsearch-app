import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { createInMemoryInviteRepository } from "../src/auth/inviteRepository.js";
import { createInviteService, hashInviteCode } from "../src/auth/inviteService.js";
import { createInMemoryUserRepository } from "../src/auth/userRepository.js";
import { createPreferenceRepository } from "../src/preferences/preferenceRepository.js";

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

function setup(authMode: "progressive" | "enforced" = "enforced") {
  const inviteRepository = createInMemoryInviteRepository();
  const userRepository = createInMemoryUserRepository();
  const app = createApp({
    userRepository,
    inviteRepository,
    preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }),
    runtimeConfig: { jwtSecret: JWT_SECRET, authMode },
  });
  return { app, userRepository, inviteRepository, invites: createInviteService({ inviteRepository }) };
}

async function call(app: ReturnType<typeof createApp>, method: string, path: string, payload?: unknown) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const data = (await response.json()) as Record<string, unknown>;
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

function errorOf(data: Record<string, unknown>): { code: unknown; message: unknown } {
  const error = data.error as Record<string, unknown>;
  return { code: error.code, message: error.message };
}

const registration = (inviteCode?: string, email = "ann@example.com") => ({
  email,
  displayName: "Ann",
  password: "pw",
  ...(inviteCode === undefined ? {} : { inviteCode }),
});

test("a closed deployment announces that registration needs an invite", async () => {
  const { app } = setup("enforced");
  const { data } = await call(app, "GET", "/auth/status");
  assert.equal(data.inviteRequired, true);
  assert.equal(data.authMode, "enforced");
  assert.equal(data.userCount, 0);
});

test("an open deployment does not ask for invites", async () => {
  const { data } = await call(setup("progressive").app, "GET", "/auth/status");
  assert.equal(data.inviteRequired, false);
  assert.equal(data.authMode, "progressive");
});

test("an invitee registers with the code and receives a session", async () => {
  const { app, invites } = setup();
  const { code } = await invites.issue({ email: "ann@example.com" });

  const r = await call(app, "POST", "/auth/register", registration(code));

  assert.equal(r.status, 201);
  assert.ok(r.data.token);
  assert.ok(r.data.recoveryCode);
});

test("registration works with the code typed in capitals and without dashes", async () => {
  const { app, invites } = setup();
  const { code } = await invites.issue({ email: "ann@example.com" });
  const r = await call(app, "POST", "/auth/register", registration(code.toUpperCase().replace(/-/g, "")));
  assert.equal(r.status, 201);
});

test("a code can only be used once", async () => {
  const { app, invites } = setup();
  const { code } = await invites.issue({ email: "ann@example.com" });

  assert.equal((await call(app, "POST", "/auth/register", registration(code))).status, 201);
  const again = await call(app, "POST", "/auth/register", registration(code));

  assert.equal(again.status, 403);
  assert.equal(errorOf(again.data).code, "invite_invalid");
});

test("a failed registration does not burn the invite", async () => {
  const { app, invites } = setup();
  const { code } = await invites.issue({ email: "ann@example.com" });

  const noPassword = await call(app, "POST", "/auth/register", { ...registration(code), password: "" });
  assert.equal(noPassword.status, 400);

  assert.equal((await call(app, "POST", "/auth/register", registration(code))).status, 201);
});

test("every way an invite can be unusable gets the identical answer", async () => {
  const { app, invites, inviteRepository } = setup();

  const wrongEmail = await invites.issue({ email: "ann@example.com" });
  const revoked = await invites.issue({ email: "bob@example.com" });
  await invites.revoke("bob@example.com");
  const expiredCode = "ffff-ffff-ffff-ffff-ffff-ffff-ffff-ffff";
  await inviteRepository.create({
    email: "cy@example.com",
    codeHash: hashInviteCode(expiredCode),
    expiresAt: "2000-01-01T00:00:00.000Z",
  });

  const attempts = [
    await call(app, "POST", "/auth/register", registration(undefined)),
    await call(app, "POST", "/auth/register", registration("")),
    await call(app, "POST", "/auth/register", registration("not-a-real-code")),
    await call(app, "POST", "/auth/register", registration(wrongEmail.code, "mallory@example.com")),
    await call(app, "POST", "/auth/register", registration(revoked.code, "bob@example.com")),
    await call(app, "POST", "/auth/register", registration(expiredCode, "cy@example.com")),
    await call(app, "POST", "/auth/register", { ...registration("x"), inviteCode: 12345 }),
  ];

  for (const attempt of attempts) {
    assert.equal(attempt.status, 403);
    assert.deepEqual(errorOf(attempt.data), { code: "invite_invalid", message: "invite code is invalid or expired" });
  }
});

test("a forwarded code does not let someone else in, and the rightful invitee can still use it", async () => {
  const { app, invites, userRepository } = setup();
  const { code } = await invites.issue({ email: "ann@example.com" });

  const thief = await call(app, "POST", "/auth/register", registration(code, "mallory@example.com"));
  assert.equal(thief.status, 403);
  assert.equal(await userRepository.countUsers(), 0);

  assert.equal((await call(app, "POST", "/auth/register", registration(code))).status, 201);
});

test("an invite for an address that already has an account cannot create a second one", async () => {
  const { app, invites, userRepository } = setup();
  await userRepository.create({ email: "ann@example.com", displayName: "Ann", passwordHash: "h", recoveryCodeHash: "r" });
  const { code } = await invites.issue({ email: "ann@example.com" });

  const r = await call(app, "POST", "/auth/register", registration(code));

  assert.equal(r.status, 400);
  assert.equal(await userRepository.countUsers(), 1);
});

test("the open deployment still registers without any invite", async () => {
  const r = await call(setup("progressive").app, "POST", "/auth/register", registration());
  assert.equal(r.status, 201);
});
