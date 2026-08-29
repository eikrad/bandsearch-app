import test from "node:test";
import assert from "node:assert/strict";
import { createAuthApiClient } from "../src/authApiClient.js";

type Recorded = { url: string; init?: RequestInit };

function clientWith(
  respond: () => { ok: boolean; body: unknown },
  getToken: () => string | null = () => "tok-123",
) {
  const calls: Recorded[] = [];
  const client = createAuthApiClient({
    apiBaseUrl: "http://api.test",
    getToken,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const { ok, body } = respond();
      return { ok, status: ok ? 200 : 401, json: async () => body };
    }) as unknown as typeof fetch,
  });
  return { client, calls };
}

test("deleting an account sends the password to the delete endpoint", async () => {
  const { client, calls } = clientWith(() => ({ ok: true, body: { ok: true, erased: { users: 1 } } }));

  const result = await client.deleteAccount({ password: "hunter2" });

  assert.equal(result.ok, true);
  assert.match(calls[0].url, /\/account\/delete$/);
  assert.equal(JSON.parse(String(calls[0].init?.body)).password, "hunter2");
});

test("deleting an account is authenticated", async () => {
  const { client, calls } = clientWith(() => ({ ok: true, body: { ok: true, erased: {} } }));

  await client.deleteAccount({ password: "hunter2" });

  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer tok-123", "the caller is identified by their token");
});

test("a failed deletion surfaces the reason to the user", async () => {
  const { client } = clientWith(() => ({
    ok: false,
    body: { error: { message: "invalid credentials" } },
  }));

  const result = await client.deleteAccount({ password: "wrong" });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "invalid credentials");
});
