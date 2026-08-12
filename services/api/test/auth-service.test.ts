import { test } from "node:test";
import assert from "node:assert/strict";

import { createInMemoryUserRepository } from "../src/auth/userRepository.js";
import { createAuthService } from "../src/auth/authService.js";

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

function freshService() {
  return createAuthService({ userRepository: createInMemoryUserRepository(), jwtSecret: JWT_SECRET });
}

async function registerSuccessfully(
  service: ReturnType<typeof createAuthService>,
  input: Parameters<ReturnType<typeof createAuthService>["register"]>[0],
) {
  const result = await service.register(input);
  if ("error" in result) throw new Error(result.error);
  assert.equal(result.ok, true);
  return result;
}

// register

test("register creates a user and returns token + recoveryCode", async () => {
  const svc = freshService();
  const result = await registerSuccessfully(svc, { email: "alice@x.com", displayName: "Alice", password: "hunter2" });
  assert.equal(result.ok, true);
  assert.equal(result.user.email, "alice@x.com");
  assert.equal(result.user.displayName, "Alice");
  assert.ok(result.token);
  assert.ok(result.recoveryCode);
  assert.equal(typeof result.recoveryCode, "string");
  assert.ok(result.recoveryCode.length >= 20);
});

test("register does not expose passwordHash in returned user", async () => {
  const svc = freshService();
  const result = await registerSuccessfully(svc, { email: "b@x.com", displayName: "B", password: "pw" });
  assert.equal("passwordHash" in result.user, false);
  assert.equal("recoveryCodeHash" in result.user, false);
});

test("register rejects duplicate email", async () => {
  const svc = freshService();
  await svc.register({ email: "dup@x.com", displayName: "D", password: "pw" });
  const result = await svc.register({ email: "dup@x.com", displayName: "D2", password: "pw2" });
  assert.equal(result.ok, false);
  assert.match(result.error, /already registered/i);
});

test("register rejects missing email", async () => {
  const svc = freshService();
  const result = await svc.register({ email: "", displayName: "X", password: "pw" });
  assert.equal(result.ok, false);
});

test("register rejects missing password", async () => {
  const svc = freshService();
  const result = await svc.register({ email: "a@x.com", displayName: "X", password: "" });
  assert.equal(result.ok, false);
});

// login

test("login returns token for correct credentials", async () => {
  const svc = freshService();
  await svc.register({ email: "c@x.com", displayName: "C", password: "correct" });
  const result = await svc.login({ email: "c@x.com", password: "correct" });
  assert.equal(result.ok, true);
  assert.ok(result.token);
  assert.equal(result.user.email, "c@x.com");
});

test("login rejects wrong password", async () => {
  const svc = freshService();
  await svc.register({ email: "d@x.com", displayName: "D", password: "right" });
  const result = await svc.login({ email: "d@x.com", password: "wrong" });
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid credentials/i);
});

test("login rejects unknown email", async () => {
  const svc = freshService();
  const result = await svc.login({ email: "ghost@x.com", password: "pw" });
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid credentials/i);
});

// verifyToken

test("verifyToken returns userId for valid token", async () => {
  const svc = freshService();
  const { user, token } = await registerSuccessfully(svc, { email: "e@x.com", displayName: "E", password: "pw" });
  const result = svc.verifyToken(token);
  assert.equal(result.ok, true);
  assert.equal(result.userId, user.id);
});

test("verifyToken rejects tampered token", () => {
  const svc = freshService();
  const result = svc.verifyToken("not.a.valid.token");
  assert.equal(result.ok, false);
});

test("verifyToken rejects token signed with wrong secret", async () => {
  const other = createAuthService({
    userRepository: createInMemoryUserRepository(),
    jwtSecret: "different-secret-also-32-chars!!",
  });
  const { token } = await registerSuccessfully(other, { email: "f@x.com", displayName: "F", password: "pw" });
  const result = freshService().verifyToken(token);
  assert.equal(result.ok, false);
});

// resetPassword

test("resetPassword succeeds with valid recovery code and returns new recovery code", async () => {
  const svc = freshService();
  const { user, recoveryCode } = await registerSuccessfully(svc, { email: "g@x.com", displayName: "G", password: "old" });
  const result = await svc.resetPassword({ email: user.email, recoveryCode, newPassword: "new" });
  assert.equal(result.ok, true);
  assert.ok(result.newRecoveryCode);
  assert.notEqual(result.newRecoveryCode, recoveryCode);
});

test("resetPassword allows login with new password after reset", async () => {
  const svc = freshService();
  const { user, recoveryCode } = await registerSuccessfully(svc, { email: "h@x.com", displayName: "H", password: "old" });
  await svc.resetPassword({ email: user.email, recoveryCode, newPassword: "new" });
  const loginResult = await svc.login({ email: user.email, password: "new" });
  assert.equal(loginResult.ok, true);
});

test("resetPassword rejects wrong recovery code", async () => {
  const svc = freshService();
  const { user } = await registerSuccessfully(svc, { email: "i@x.com", displayName: "I", password: "pw" });
  const result = await svc.resetPassword({ email: user.email, recoveryCode: "wrong-code", newPassword: "new" });
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid recovery code/i);
});

test("resetPassword rejects unknown email", async () => {
  const svc = freshService();
  const result = await svc.resetPassword({ email: "nobody@x.com", recoveryCode: "code", newPassword: "pw" });
  assert.equal(result.ok, false);
});
