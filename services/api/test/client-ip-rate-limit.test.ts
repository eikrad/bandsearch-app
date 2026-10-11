import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { createInMemoryUserRepository } from "../src/auth/userRepository.js";
import { createPreferenceRepository } from "../src/preferences/preferenceRepository.js";

// Behind Render's proxy every request arrives from the proxy's address; the
// real client is in X-Forwarded-For. Rate limits must key on that client.
async function withServer<T>(run: (post: (clientIp: string) => Promise<number>) => Promise<T>): Promise<T> {
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
    return await run(async (clientIp) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/recommendations`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
        body: JSON.stringify({}),
      });
      return response.status;
    });
  } finally {
    server.close();
  }
}

test("a client that exhausts the recommendation rate limit does not block other clients behind the same proxy", async () => {
  await withServer(async (post) => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = await post("203.0.113.1");
    assert.equal(last, 429, "the noisy client is limited");
    assert.notEqual(await post("203.0.113.2"), 429, "a different client is not");
  });
});
