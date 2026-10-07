import { test } from "node:test";
import assert from "node:assert/strict";

import { checkConstraints, constraintRate, createConstraintChecker, type ArtistFacts } from "./constraints.ts";

const icelandic: ArtistFacts = { country: "IS", lifeSpan: { begin: "2013", ended: false } };
const norwegian: ArtistFacts = { country: "NO", lifeSpan: { begin: "1991", ended: true } };
const noArea: ArtistFacts = { country: null, lifeSpan: { ended: false } };

// ─── one band against one set of constraints ──────────────────────────────────

test("a band from the required country meets a country constraint", () => {
  assert.deepEqual(checkConstraints({ country: "IS" }, icelandic), { verdict: "met", failed: [] });
});

test("a band from another country misses it, and says which constraint failed", () => {
  assert.deepEqual(checkConstraints({ country: "IS" }, norwegian), { verdict: "missed", failed: ["country"] });
});

test("a band with no recorded area is unknown, not a miss", () => {
  assert.deepEqual(checkConstraints({ country: "IS" }, noArea), { verdict: "unknown", failed: [] });
});

test("formation year bounds read the year from MusicBrainz's begin date", () => {
  assert.equal(checkConstraints({ formedFrom: 2013 }, icelandic).verdict, "met", "inclusive: formed in 2013");
  assert.equal(checkConstraints({ formedFrom: 2014 }, icelandic).verdict, "missed");
  assert.equal(checkConstraints({ formedUntil: 2000 }, norwegian).verdict, "met");
  assert.equal(checkConstraints({ formedFrom: 2010 }, noArea).verdict, "unknown", "no begin date recorded");
});

test("an ended constraint checks whether the band has split up", () => {
  assert.equal(checkConstraints({ ended: true }, norwegian).verdict, "met");
  assert.equal(checkConstraints({ ended: true }, icelandic).verdict, "missed");
});

test("all constraints must hold: one miss outweighs unknowns, unknowns outweigh hits", () => {
  assert.equal(checkConstraints({ country: "IS", ended: true }, icelandic).verdict, "missed");
  assert.equal(checkConstraints({ country: "IS", formedFrom: 2010 }, { ...icelandic, lifeSpan: { ended: false } }).verdict, "unknown");
});

test("unknown facts (the lookup failed) leave the band unknown", () => {
  assert.equal(checkConstraints({ country: "IS" }, null).verdict, "unknown");
});

// ─── the rate over a query's top bands ────────────────────────────────────────

test("the constraint rate counts only bands that could be decided", () => {
  assert.equal(constraintRate(["met", "missed", "unknown", "met"]), 2 / 3);
  assert.equal(constraintRate(["unknown", "unknown"]), null);
  assert.equal(constraintRate([]), null);
});

// ─── shared members, looked up through MusicBrainz ────────────────────────────

function fakeMusicBrainz(members: Record<string, string[]>, facts: Record<string, ArtistFacts> = {}) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      lookupArtist: async (mbid: string) => {
        calls.push(`artist:${mbid}`);
        return facts[mbid] ?? noArea;
      },
      lookupBandMembers: async (mbid: string) => {
        calls.push(`members:${mbid}`);
        return members[mbid] ?? [];
      },
    },
  };
}

test("a band shares a member with the reference band when one person plays in both", async () => {
  const { client } = fakeMusicBrainz({ alcest: ["neige", "winterhalter"], amesoeurs: ["neige", "audrey"], fen: ["the watcher"] });
  const checker = createConstraintChecker(client);
  const constraint = { sharesMemberWith: { mbid: "alcest", name: "Alcest" } };

  assert.equal((await checker.check({ artist: "Amesoeurs", musicbrainzArtistId: "amesoeurs" }, constraint)).verdict, "met");
  assert.deepEqual(await checker.check({ artist: "Fen", musicbrainzArtistId: "fen" }, constraint), {
    verdict: "missed",
    failed: ["sharesMemberWith"],
  });
});

test("the reference band itself is a miss: it is not a side project of itself", async () => {
  const { client } = fakeMusicBrainz({ alcest: ["neige"] });
  const checker = createConstraintChecker(client);
  const result = await checker.check({ artist: "Alcest", musicbrainzArtistId: "alcest" }, { sharesMemberWith: { mbid: "alcest", name: "Alcest" } });
  assert.equal(result.verdict, "missed");
});

test("a band with no recorded members is unknown for a shared-member constraint", async () => {
  const { client } = fakeMusicBrainz({ alcest: ["neige"], solo: [] });
  const checker = createConstraintChecker(client);
  const result = await checker.check({ artist: "Solo", musicbrainzArtistId: "solo" }, { sharesMemberWith: { mbid: "alcest", name: "Alcest" } });
  assert.equal(result.verdict, "unknown");
});

test("a band without a MusicBrainz id cannot be checked", async () => {
  const { client, calls } = fakeMusicBrainz({});
  const checker = createConstraintChecker(client);
  assert.equal((await checker.check({ artist: "Ghost" }, { country: "IS" })).verdict, "unknown");
  assert.deepEqual(calls, []);
});

test("each artist and the reference band's members are looked up once per run", async () => {
  const { client, calls } = fakeMusicBrainz({ alcest: ["neige"], amesoeurs: ["neige"] }, { amesoeurs: icelandic });
  const checker = createConstraintChecker(client);
  const constraint = { country: "IS", sharesMemberWith: { mbid: "alcest", name: "Alcest" } };

  await checker.check({ artist: "Amesoeurs", musicbrainzArtistId: "amesoeurs" }, constraint);
  await checker.check({ artist: "Amesoeurs", musicbrainzArtistId: "amesoeurs" }, constraint);

  assert.deepEqual(calls.sort(), ["artist:amesoeurs", "members:alcest", "members:amesoeurs"]);
});
