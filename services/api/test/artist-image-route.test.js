const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/app");

async function makeGetRequest(app, path) {
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

function createImageClientStub(imageUrl) {
  return {
    getArtistImageUrl: async (name) => (name ? imageUrl : null),
  };
}

test("GET /artists/image returns image URL from Wikidata client", async () => {
  const app = createApp({
    artistImageClient: createImageClientStub("https://commons.wikimedia.org/w/fen.jpg"),
  });

  const result = await makeGetRequest(app, "/artists/image?name=Fen");

  assert.equal(result.status, 200);
  assert.equal(result.data.imageUrl, "https://commons.wikimedia.org/w/fen.jpg");
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
  assert.equal(noName.data.error.code, "validation_error");
});
