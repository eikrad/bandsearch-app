import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createReplayFetch } from "../src/integrations/replayFetch.js";

/** An upstream that answers from a table and counts calls. */
function upstream(answers: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const hit = Object.entries(answers).find(([prefix]) => url.startsWith(prefix));
    const answer = hit?.[1] ?? { status: 500, body: { error: "unrouted" } };
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const dir = () => mkdtempSync(join(tmpdir(), "replay-"));

test("the first request goes upstream and is recorded; the same request is then replayed", async () => {
  const { fetchImpl, calls } = upstream({ "https://api.search.brave.com/": { status: 200, body: { web: { results: [1] } } } });
  const replay = createReplayFetch({ dir: dir(), fetchImpl });
  const url = "https://api.search.brave.com/res/v1/web/search?q=ffo+alcest";

  const first = await replay(url);
  const second = await replay(url);

  assert.equal(calls.length, 1, "the second answer came from the recording");
  assert.deepEqual(await first.json(), { web: { results: [1] } });
  assert.deepEqual(await second.json(), { web: { results: [1] } });
  assert.equal(second.status, 200);
});

test("failed answers are not recorded, so a later run retries them", async () => {
  const { fetchImpl, calls } = upstream({ "https://musicbrainz.org/": { status: 503, body: {} } });
  const replay = createReplayFetch({ dir: dir(), fetchImpl });
  const url = "https://musicbrainz.org/ws/2/artist?query=Fen&fmt=json";

  await replay(url);
  await replay(url);

  assert.equal(calls.length, 2);
});

test("a 404 is a real answer (no such artist) and is replayed too", async () => {
  const { fetchImpl, calls } = upstream({ "https://musicbrainz.org/": { status: 404, body: { error: "Not Found" } } });
  const replay = createReplayFetch({ dir: dir(), fetchImpl });
  const url = "https://musicbrainz.org/ws/2/artist/missing?fmt=json";

  await replay(url);
  const again = await replay(url);

  assert.equal(calls.length, 1);
  assert.equal(again.status, 404);
});

test("an API key in the URL is neither part of the recording's key nor stored", async () => {
  const recordings = dir();
  const { fetchImpl, calls } = upstream({ "https://ws.audioscrobbler.com/": { status: 200, body: { artist: {} } } });
  const replay = createReplayFetch({ dir: recordings, fetchImpl });

  await replay("https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=Fen&api_key=SECRET-ONE&format=json");
  await replay("https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=Fen&api_key=SECRET-TWO&format=json");

  assert.equal(calls.length, 1, "a rotated key still replays the same answer");
  const stored = readdirSync(recordings, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readFileSync(join(recordings, f), "utf8"))
    .join("\n");
  assert.ok(!stored.includes("SECRET"), "no key in any recording");
});

test("only real upstream calls are spaced for a host's rate limit; replays are immediate", async () => {
  const { fetchImpl } = upstream({ "https://musicbrainz.org/": { status: 200, body: {} } });
  const replay = createReplayFetch({ dir: dir(), fetchImpl, minIntervalMsByHost: { "musicbrainz.org": 200 } });

  let start = Date.now();
  await replay("https://musicbrainz.org/ws/2/artist/a?fmt=json");
  await replay("https://musicbrainz.org/ws/2/artist/b?fmt=json");
  assert.ok(Date.now() - start >= 190, "two misses are spaced by the host's interval");

  start = Date.now();
  await replay("https://musicbrainz.org/ws/2/artist/a?fmt=json");
  await replay("https://musicbrainz.org/ws/2/artist/b?fmt=json");
  assert.ok(Date.now() - start < 100, "two replays are not throttled");
});
