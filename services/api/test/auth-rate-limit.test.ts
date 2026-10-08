import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { createInMemoryUserRepository } from "../src/auth/userRepository.js";
import { createPreferenceRepository } from "../src/preferences/preferenceRepository.js";

async function withServer<T>(run: (send: (method: string, path: string, clientIp?: string) => Promise<{ status: number; body: Record<string, unknown> }>) => Promise<T>) {
  const app = createApp({
    userRepository: createInMemoryUserRepository(),
    preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }),
    runtimeConfig: { jwtSecret: "test-secret-at-least-32-chars-long!!" },
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await run(async (method, path, clientIp = "203.0.113.1") => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method,
        headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
        body: method === "GET" ? undefined : JSON.stringify({ email: "a@x.com", password: "wrong" }),
      });
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    });
  } finally {
    server.close();
  }
}

test("password guessing against /auth/login is cut off after 20 attempts", async () => {
  await withServer(async (send) => {
    for (let i = 0; i < 20; i++) assert.equal((await send("POST", "/auth/login")).status, 401);
    const blocked = await send("POST", "/auth/login");
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, {
      error: { code: "rate_limit_exceeded", message: "too many authentication attempts" },
    });
  });
});

test("registration and password reset draw on the same allowance as login", async () => {
  await withServer(async (send) => {
    for (let i = 0; i < 10; i++) await send("POST", "/auth/login");
    for (let i = 0; i < 5; i++) await send("POST", "/auth/register");
    for (let i = 0; i < 5; i++) await send("POST", "/auth/reset-password");
    assert.equal((await send("POST", "/auth/login")).status, 429);
    assert.equal((await send("POST", "/auth/register")).status, 429);
    assert.equal((await send("POST", "/auth/reset-password")).status, 429);
  });
});

test("one client being limited does not lock out another", async () => {
  await withServer(async (send) => {
    for (let i = 0; i < 21; i++) await send("POST", "/auth/login", "203.0.113.1");
    assert.equal((await send("POST", "/auth/login", "203.0.113.1")).status, 429);
    assert.equal((await send("POST", "/auth/login", "203.0.113.2")).status, 401);
  });
});

test("the status check the client makes on every start is never rate limited", async () => {
  await withServer(async (send) => {
    for (let i = 0; i < 25; i++) assert.equal((await send("GET", "/auth/status")).status, 200);
  });
});
