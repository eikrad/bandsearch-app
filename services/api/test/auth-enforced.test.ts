import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

import { createApp } from "../src/app.js";
import { createInMemoryUserRepository } from "../src/auth/userRepository.js";
import { createPreferenceRepository } from "../src/preferences/preferenceRepository.js";

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

type Mode = "progressive" | "enforced";

function appWith(authMode: Mode, userRepository = createInMemoryUserRepository()) {
  return createApp({
    userRepository,
    preferenceRepository: createPreferenceRepository({ preferenceStore: "memory" }),
    musicBrainzClient: { searchArtists: async () => [] },
    artistImageClient: { getArtistImageUrl: async () => null },
    runtimeConfig: { jwtSecret: JWT_SECRET, authMode },
  });
}

async function addUser(repo: ReturnType<typeof createInMemoryUserRepository>, email = "a@x.com") {
  const user = await repo.create({ email, displayName: "A", passwordHash: "h", recoveryCodeHash: "r" });
  return { user, token: jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: "1h" }) };
}

async function status(app: ReturnType<typeof createApp>, path: string, token?: string): Promise<number> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return response.status;
  } finally {
    server.close();
  }
}

test("enforced mode refuses anonymous requests even before anyone has registered", async () => {
  assert.equal(await status(appWith("enforced"), "/preferences"), 401);
});

test("enforced mode does not wave through anonymous requests when exactly one user exists", async () => {
  const repo = createInMemoryUserRepository();
  await addUser(repo);
  assert.equal(await status(appWith("enforced", repo), "/preferences"), 401);
});

test("enforced mode does not fall back to the only user when the token is invalid", async () => {
  const repo = createInMemoryUserRepository();
  await addUser(repo);
  assert.equal(await status(appWith("enforced", repo), "/preferences", "garbage"), 401);
});

test("enforced mode serves a request carrying a valid token", async () => {
  const repo = createInMemoryUserRepository();
  const { token } = await addUser(repo);
  assert.equal(await status(appWith("enforced", repo), "/preferences", token), 200);
});

test("enforced mode rejects a correctly signed token whose user no longer exists", async () => {
  const stale = jwt.sign({ sub: "deleted-user" }, JWT_SECRET, { expiresIn: "1h" });
  assert.equal(await status(appWith("enforced"), "/preferences", stale), 401);
});

test("enforced mode locks out a disabled user immediately and lets them back in once enabled", async () => {
  const repo = createInMemoryUserRepository();
  const { user, token } = await addUser(repo);
  const app = appWith("enforced", repo);

  await repo.setDisabled(user.id, true);
  assert.equal(await status(app, "/preferences", token), 401);

  await repo.setDisabled(user.id, false);
  assert.equal(await status(app, "/preferences", token), 200);
});

test("enforced mode puts artist search and artist images behind authentication", async () => {
  const repo = createInMemoryUserRepository();
  const { token } = await addUser(repo);
  const app = appWith("enforced", repo);

  assert.equal(await status(app, "/artists/search?query=alcest"), 401);
  assert.equal(await status(app, "/artists/image?name=alcest"), 401);
  assert.equal(await status(app, "/artists/search?query=alcest", token), 200);
  assert.equal(await status(app, "/artists/image?name=alcest", token), 200);
});

test("enforced mode keeps health, version and auth status public", async () => {
  const app = appWith("enforced");
  assert.equal(await status(app, "/health"), 200);
  assert.equal(await status(app, "/version"), 200);
  assert.equal(await status(app, "/auth/status"), 200);
});

test("progressive mode stays open for a fresh install and for artist search", async () => {
  const app = appWith("progressive");
  assert.equal(await status(app, "/preferences"), 200);
  assert.equal(await status(app, "/artists/search?query=alcest"), 200);
});

test("an app configured for enforced auth without a signing secret refuses to be built", () => {
  assert.throws(
    () => createApp({ runtimeConfig: { authMode: "enforced" } }),
    /JWT_SECRET/,
  );
});
