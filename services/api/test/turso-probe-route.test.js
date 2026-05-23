const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

function makeClient(executeImpl) {
  return () => ({ execute: executeImpl });
}

async function req(app, method, path, payload) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

test("POST /preferences/turso/test returns ok true when client executes", async () => {
  const app = createApp({
    createTursoClient: makeClient(async () => ({ rows: [{ "1": 1 }], rowsAffected: 0 })),
  });

  const result = await req(app, "POST", "/preferences/turso/test", {
    databaseUrl: "libsql://test.turso.io",
    authToken: "tok",
  });

  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
});

test("POST /preferences/turso/test returns ok false when client throws", async () => {
  const app = createApp({
    createTursoClient: makeClient(async () => { throw new Error("connection refused"); }),
  });

  const result = await req(app, "POST", "/preferences/turso/test", {
    databaseUrl: "libsql://bad.turso.io",
    authToken: "tok",
  });

  assert.equal(result.status, 200);
  assert.equal(result.data.ok, false);
  assert.equal(result.data.error, "connection refused");
});

test("POST /preferences/turso/test returns 400 when databaseUrl is missing", async () => {
  const app = createApp();

  const result = await req(app, "POST", "/preferences/turso/test", { authToken: "tok" });

  assert.equal(result.status, 400);
  assert.equal(result.data.error.code, "validation_error");
});

test("POST /preferences/turso/test accepts empty authToken", async () => {
  const app = createApp({
    createTursoClient: makeClient(async () => ({ rows: [], rowsAffected: 0 })),
  });

  const result = await req(app, "POST", "/preferences/turso/test", {
    databaseUrl: "libsql://test.turso.io",
  });

  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
});
