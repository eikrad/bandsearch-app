import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";

function asRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  assert.ok(typeof value === "string");
  return value;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  asRecord(value);
  return value;
}

async function makeGetRequest(app: ReturnType<typeof createApp>, path: string) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    const data: unknown = await response.json();
    asRecord(data);
    return { status: response.status, data };
  } finally {
    server.close();
  }
}

function createImageClientStub(imageUrl: string | null) {
  return {
    getArtistImageUrl: async (name: string) => (name ? imageUrl : null),
  };
}

test("GET /artists/image returns image URL from Wikidata client", async () => {
  const app = createApp({
    artistImageClient: createImageClientStub("https://commons.wikimedia.org/w/fen.jpg"),
  });

  const result = await makeGetRequest(app, "/artists/image?name=Fen");

  assert.equal(result.status, 200);
  assert.equal(stringField(result.data, "imageUrl"), "https://commons.wikimedia.org/w/fen.jpg");
});

test("GET /artists/image returns null imageUrl when not found", async () => {
  const app = createApp({
    artistImageClient: createImageClientStub(null),
  });

  const result = await makeGetRequest(app, "/artists/image?name=Unknown+Artist+XYZ");

  assert.equal(result.status, 200);
  assert.equal(result.data.imageUrl, null);
});

test("GET /artists/image requires non-empty name parameter", async () => {
  const app = createApp({
    artistImageClient: createImageClientStub(null),
  });

  const noName = await makeGetRequest(app, "/artists/image");
  assert.equal(noName.status, 400);
  assert.equal(stringField(recordField(noName.data, "error"), "code"), "validation_error");
});
