const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

async function makeRequest(app, path) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = server.address().port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

test("GET /health returns ok status", async () => {
  const app = createApp();
  const result = await makeRequest(app, "/health");

  assert.equal(result.status, 200);
  assert.equal(result.data.status, "ok");
});

test("GET /version returns app version", async () => {
  const app = createApp();
  const result = await makeRequest(app, "/version");

  assert.equal(result.status, 200);
  assert.equal(typeof result.data.version, "string");
  assert.equal(result.data.version.length > 0, true);
});
