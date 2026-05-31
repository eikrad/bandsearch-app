const test = require("node:test");
const assert = require("node:assert/strict");

test("DISCOVERY_DOMAINS is exported as a non-empty array containing key domain substrings", () => {
  const { DISCOVERY_DOMAINS } = require("../../src/eval/searchSourceScorer");
  assert.ok(Array.isArray(DISCOVERY_DOMAINS));
  assert.ok(DISCOVERY_DOMAINS.length > 0);
  assert.ok(DISCOVERY_DOMAINS.some((d) => d.includes("bandcamp")));
  assert.ok(DISCOVERY_DOMAINS.some((d) => d.includes("rateyourmusic") || d.includes("rym")));
  assert.ok(DISCOVERY_DOMAINS.some((d) => d.includes("reddit")));
});

test("scoreSearchSources: returns 1.0 when all URLs are from discovery domains", () => {
  const { scoreSearchSources } = require("../../src/eval/searchSourceScorer");
  const urls = [
    "https://bandcamp.com/track/xyz",
    "https://rateyourmusic.com/artist/xyz",
    "https://www.reddit.com/r/metal/comments/xyz",
  ];
  assert.equal(scoreSearchSources(urls), 1.0);
});

test("scoreSearchSources: returns 0.0 when no URLs are from discovery domains", () => {
  const { scoreSearchSources } = require("../../src/eval/searchSourceScorer");
  const urls = [
    "https://example.com/foo",
    "https://generic-blog.net/bar",
  ];
  assert.equal(scoreSearchSources(urls), 0.0);
});

test("scoreSearchSources: returns correct ratio for a mix of discovery and generic URLs", () => {
  const { scoreSearchSources } = require("../../src/eval/searchSourceScorer");
  const urls = [
    "https://bandcamp.com/track/xyz",   // discovery
    "https://example.com/foo",           // generic
    "https://rateyourmusic.com/artist",  // discovery
    "https://generic-blog.net/bar",      // generic
  ];
  assert.equal(scoreSearchSources(urls), 0.5);
});

test("scoreSearchSources: returns 0 for an empty array", () => {
  const { scoreSearchSources } = require("../../src/eval/searchSourceScorer");
  assert.equal(scoreSearchSources([]), 0);
});

test("scoreSearchSources: matches partial URL substrings (subdomain or path variants)", () => {
  const { scoreSearchSources } = require("../../src/eval/searchSourceScorer");
  const urls = [
    "https://artist.bandcamp.com/album/xyz",    // bandcamp subdomain
    "https://www.metal-archives.com/bands/xyz",  // metal-archives
  ];
  assert.equal(scoreSearchSources(urls), 1.0);
});
