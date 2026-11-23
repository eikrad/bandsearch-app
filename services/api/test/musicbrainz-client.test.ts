import { test } from "node:test";
import assert from "node:assert/strict";

import { createMusicBrainzClient } from "../src/integrations/musicbrainz.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("MusicBrainz client maps artist search results", async () => {
  const fakeFetch = async () =>
    jsonResponse({
      artists: [
        { id: "a1", name: "Alcest", score: 98, disambiguation: "FR" },
        { id: "a2", name: "Agalloch", score: 95 },
      ],
    });

  const client = createMusicBrainzClient({ fetchImpl: fakeFetch, minIntervalMs: 0 });
  const artists = await client.searchArtists("alcest");

  assert.deepEqual(artists, [
    { id: "a1", name: "Alcest", score: 98, disambiguation: "FR" },
    { id: "a2", name: "Agalloch", score: 95, disambiguation: "" },
  ]);
});

test("MusicBrainz client throws on non-OK responses", async () => {
  const fakeFetch = async () => new Response(null, { status: 503 });

  const client = createMusicBrainzClient({ fetchImpl: fakeFetch, minIntervalMs: 0 });

  await assert.rejects(
    () => client.searchArtists("alcest"),
    /musicbrainz request failed with status 503/,
  );
});

test("a busy MusicBrainz (503) is asked again, so a real artist is not reported as missing", async () => {
  const statuses = [503, 503, 200];
  const client = createMusicBrainzClient({
    fetchImpl: async () => {
      const status = statuses.shift()!;
      return status === 200 ? jsonResponse({ artists: [{ id: "a1", name: "Alcest", score: 100 }] }) : new Response(null, { status });
    },
    minIntervalMs: 0,
  });
  assert.deepEqual((await client.searchArtists("alcest")).map((a) => a.id), ["a1"]);
});

test("a retry after 503 waits for its own slot in the rate gate", async () => {
  const startedAt: number[] = [];
  const client = createMusicBrainzClient({
    fetchImpl: async () => {
      startedAt.push(Date.now());
      return startedAt.length === 1 ? new Response(null, { status: 503 }) : jsonResponse({ artists: [] });
    },
    minIntervalMs: 40,
  });
  await client.searchArtists("alcest");
  assert.equal(startedAt.length, 2);
  assert.ok(startedAt[1]! - startedAt[0]! >= 35, `retry gap too small: ${startedAt[1]! - startedAt[0]!}ms`);
});

test("findArtistsByName asks for many artists in one request and maps tags, aliases and life span", async () => {
  const urls: URL[] = [];
  const client = createMusicBrainzClient({
    fetchImpl: async (url: string | URL | Request) => {
      urls.push(new URL(String(url)));
      return jsonResponse({
        artists: [
          {
            id: "fen", name: "Fen", score: 100,
            tags: [{ name: "blackgaze", count: 3 }],
            aliases: [{ name: "Fen (UK)" }],
            "life-span": { begin: "2006", ended: null },
            country: "GB",
          },
          { id: "sunn", name: "Sunn O)))", score: 90 },
        ],
      });
    },
    minIntervalMs: 0,
  });

  const artists = await client.findArtistsByName(["Fen", "Sunn O)))", 'The "Quoted" Band']);

  assert.equal(urls.length, 1);
  assert.equal(urls[0]!.searchParams.get("query"), 'artist:"Fen" OR artist:"Sunn O)))" OR artist:"The \\"Quoted\\" Band"');
  assert.equal(urls[0]!.searchParams.get("limit"), "100");
  assert.deepEqual(artists, [
    { id: "fen", name: "Fen", score: 100, aliases: ["Fen (UK)"], tags: ["blackgaze"], lifeSpan: { begin: "2006", end: undefined, ended: false }, country: "GB" },
    { id: "sunn", name: "Sunn O)))", score: 90, aliases: [], tags: [], lifeSpan: { begin: undefined, end: undefined, ended: false }, country: null },
  ]);
});

test("findArtistsByName can also search aliases", async () => {
  let query: string | null = null;
  const client = createMusicBrainzClient({
    fetchImpl: async (url: string | URL | Request) => {
      query = new URL(String(url)).searchParams.get("query");
      return jsonResponse({ artists: [] });
    },
    minIntervalMs: 0,
  });
  await client.findArtistsByName(["Keiji Haino"], { includeAliases: true });
  assert.equal(query, 'artist:"Keiji Haino" OR alias:"Keiji Haino"');
});

test("a busy MusicBrainz is asked once more for aliases, four times more for names", async () => {
  for (const [includeAliases, requests] of [[true, 2], [false, 5]] as const) {
    let sent = 0;
    const client = createMusicBrainzClient({
      fetchImpl: async () => { sent += 1; return new Response(null, { status: 503 }); },
      minIntervalMs: 0,
    });
    await assert.rejects(client.findArtistsByName(["Fen"], { includeAliases }), /503/);
    assert.equal(sent, requests);
  }
});

test("findArtistsByName sends nothing when there is no name to look for", async () => {
  const client = createMusicBrainzClient({
    fetchImpl: async () => { throw new Error("unexpected request"); },
    minIntervalMs: 0,
  });
  assert.deepEqual(await client.findArtistsByName([" ", ""]), []);
});

test("MusicBrainz client spaces concurrent requests by minIntervalMs", async () => {
  // MusicBrainz declines *all* traffic from an IP that averages above 1 req/s
  // (HTTP 503) until the rate drops — so search + lookup must share one gate.
  const startedAt: number[] = [];
  const fakeFetch = async () => {
    startedAt.push(Date.now());
    return jsonResponse({ artists: [] });
  };
  const client = createMusicBrainzClient({ fetchImpl: fakeFetch, minIntervalMs: 40, retries: 0 });
  await Promise.all([client.searchArtists("a"), client.searchArtists("b"), client.searchArtists("c")]);
  assert.equal(startedAt.length, 3);
  assert.ok(startedAt[1]! - startedAt[0]! >= 35, `gap 1 too small: ${startedAt[1]! - startedAt[0]!}ms`);
  assert.ok(startedAt[2]! - startedAt[1]! >= 35, `gap 2 too small: ${startedAt[2]! - startedAt[1]!}ms`);
});

test("MusicBrainz clients share one process-wide rate gate", async () => {
  const startedAt: number[] = [];
  const fakeFetch = async () => {
    startedAt.push(Date.now());
    return jsonResponse({ artists: [] });
  };
  const a = createMusicBrainzClient({ fetchImpl: fakeFetch, minIntervalMs: 40, retries: 0 });
  const b = createMusicBrainzClient({ fetchImpl: fakeFetch, minIntervalMs: 40, retries: 0 });
  await Promise.all([a.searchArtists("x"), b.searchArtists("y")]);
  assert.equal(startedAt.length, 2);
  assert.ok(startedAt[1]! - startedAt[0]! >= 35, `shared gate gap too small: ${startedAt[1]! - startedAt[0]!}ms`);
});

test("lookupArtist maps tags genres urls and life-span", async () => {
  let requestedUrl = "";
  const fakeFetch = async (url: string | URL | Request) => {
    requestedUrl = String(url);
    return jsonResponse({
        id: "mbid-1",
        name: "Grade",
        tags: [{ name: "hardcore", count: 2 }],
        genres: [{ name: "melodic hardcore", count: 1 }],
        "life-span": { begin: "1994", end: null, ended: false },
        relations: [
          {
            type: "bandcamp",
            url: { resource: "https://grade.bandcamp.com" },
          },
        ],
      });
  };

  const client = createMusicBrainzClient({ fetchImpl: fakeFetch, retries: 0, minIntervalMs: 0 });
  const details = await client.lookupArtist("mbid-1");

  assert.match(requestedUrl, /\/artist\/mbid-1\?/);
  assert.match(requestedUrl, /inc=tags\+genres\+url-rels/);
  assert.equal(details.name, "Grade");
  assert.deepEqual(details.tags, ["hardcore"]);
  assert.deepEqual(details.genres, ["melodic hardcore"]);
  assert.equal(details.lifeSpan.begin, "1994");
  assert.equal(details.lifeSpan.ended, false);
  assert.ok(details.urls.some((u) => u.url.includes("bandcamp")));
});

test("lookupArtist rejects empty mbid", async () => {
  const client = createMusicBrainzClient({
    fetchImpl: async () => jsonResponse({}),
    minIntervalMs: 0,
  });
  await assert.rejects(() => client.lookupArtist(""), /mbid is required/);
});

// ─── facts for constraint queries (#253) ─────────────────────────────────────

test("lookupArtist reports the artist's country as an ISO code", async () => {
  const client = createMusicBrainzClient({
    fetchImpl: async () => jsonResponse({ id: "m", name: "Misþyrming", country: "IS", area: { name: "Iceland" } }),
    retries: 0,
    minIntervalMs: 0,
  });
  assert.equal((await client.lookupArtist("m")).country, "IS");
});

test("lookupArtist derives the country from a city area when MusicBrainz gives no country", async () => {
  const client = createMusicBrainzClient({
    fetchImpl: async () =>
      jsonResponse({ id: "m", name: "Sinmara", area: { name: "Reykjavík", "iso-3166-2-codes": ["IS-1"] } }),
    retries: 0,
    minIntervalMs: 0,
  });
  assert.equal((await client.lookupArtist("m")).country, "IS");
});

test("lookupArtist reports no country when MusicBrainz records no area", async () => {
  const client = createMusicBrainzClient({
    fetchImpl: async () => jsonResponse({ id: "m", name: "Unknown" }),
    retries: 0,
    minIntervalMs: 0,
  });
  assert.equal((await client.lookupArtist("m")).country, null);
});

test("lookupBandMembers lists the people recorded as members of a band", async () => {
  let requestedUrl = "";
  const client = createMusicBrainzClient({
    fetchImpl: async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return jsonResponse({
        id: "alcest",
        relations: [
          { type: "member of band", direction: "backward", artist: { id: "neige", name: "Neige" } },
          { type: "member of band", direction: "backward", artist: { id: "winterhalter", name: "Winterhalter" } },
          { type: "collaboration", direction: "forward", artist: { id: "other", name: "Other" } },
          { type: "bandcamp", url: { resource: "https://alcest.bandcamp.com" } },
        ],
      });
    },
    retries: 0,
    minIntervalMs: 0,
  });

  const members = await client.lookupBandMembers("alcest");

  assert.match(requestedUrl, /\/artist\/alcest\?fmt=json&inc=artist-rels/);
  assert.deepEqual(members, ["neige", "winterhalter"]);
});
