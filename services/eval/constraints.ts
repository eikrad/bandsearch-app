/**
 * Hard constraints on golden queries, checked against MusicBrainz facts with
 * plain code (#253). Open-ended queries ("sounds like …") have no right answer
 * and need tags or a judge; a constraint like "from Iceland" or "formed after
 * 2015" is either true of a band or not, whichever bands come back — which
 * suits a product where varied answers are wanted.
 */

export type GoldenConstraints = {
  /** ISO 3166-1 code, e.g. "IS". */
  country?: string;
  /** Formed in this year or later (inclusive). */
  formedFrom?: number;
  /** Formed in this year or earlier (inclusive). */
  formedUntil?: number;
  /** true: split up; false: still active. */
  ended?: boolean;
  /** Shares at least one past or present member with this band. */
  sharesMemberWith?: { mbid: string; name: string };
};

export type ConstraintName = keyof GoldenConstraints;
export type Verdict = "met" | "missed" | "unknown";
export type ConstraintCheck = { verdict: Verdict; failed: ConstraintName[] };

/** What MusicBrainz knows about a band, as far as constraints need it. */
export type ArtistFacts = {
  country: string | null;
  lifeSpan: { begin?: string; ended: boolean };
  /** Member ids; only looked up when a shared-member constraint asks. */
  members?: string[];
};

type Outcome = boolean | null; // null: MusicBrainz does not record it

function beganYear(facts: ArtistFacts): number | null {
  const year = Number.parseInt(String(facts.lifeSpan.begin ?? "").slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function outcomes(
  constraints: GoldenConstraints,
  facts: ArtistFacts,
  reference: { members: string[]; isReference: boolean } | null,
): Array<[ConstraintName, Outcome]> {
  const result: Array<[ConstraintName, Outcome]> = [];
  if (constraints.country !== undefined) {
    result.push(["country", facts.country === null ? null : facts.country.toUpperCase() === constraints.country.toUpperCase()]);
  }
  const year = beganYear(facts);
  if (constraints.formedFrom !== undefined) result.push(["formedFrom", year === null ? null : year >= constraints.formedFrom]);
  if (constraints.formedUntil !== undefined) result.push(["formedUntil", year === null ? null : year <= constraints.formedUntil]);
  if (constraints.ended !== undefined) result.push(["ended", facts.lifeSpan.ended === constraints.ended]);
  if (constraints.sharesMemberWith !== undefined) {
    if (!reference) result.push(["sharesMemberWith", null]);
    else if (reference.isReference) result.push(["sharesMemberWith", false]);
    else if (!facts.members || facts.members.length === 0) result.push(["sharesMemberWith", null]);
    else result.push(["sharesMemberWith", facts.members.some((m) => reference.members.includes(m))]);
  }
  return result;
}

/**
 * All constraints must hold. One miss decides the band as missed; otherwise
 * an unknown fact leaves it unknown; only when every constraint is known and
 * true is it met. Null facts mean the lookup failed: unknown.
 */
export function checkConstraints(
  constraints: GoldenConstraints,
  facts: ArtistFacts | null,
  reference: { members: string[]; isReference: boolean } | null = null,
): ConstraintCheck {
  if (!facts) return { verdict: "unknown", failed: [] };
  const checked = outcomes(constraints, facts, reference);
  const failed = checked.filter(([, ok]) => ok === false).map(([name]) => name);
  if (failed.length > 0) return { verdict: "missed", failed };
  if (checked.some(([, ok]) => ok === null)) return { verdict: "unknown", failed: [] };
  return { verdict: "met", failed: [] };
}

/** Share of decided bands that meet every constraint; null when none could be decided. */
export function constraintRate(verdicts: Verdict[]): number | null {
  const decided = verdicts.filter((v) => v !== "unknown");
  return decided.length === 0 ? null : decided.filter((v) => v === "met").length / decided.length;
}

type MusicBrainzFacts = {
  lookupArtist(mbid: string): Promise<{ country: string | null; lifeSpan: { begin?: string; ended: boolean } }>;
  lookupBandMembers(mbid: string): Promise<string[]>;
};

/**
 * Checks recommended bands against a query's constraints, looking each artist
 * and each band's members up once per run (MusicBrainz allows 1 req/s).
 */
export function createConstraintChecker(musicBrainz: MusicBrainzFacts) {
  const artistCache = new Map<string, Promise<ArtistFacts | null>>();
  const membersCache = new Map<string, Promise<string[] | null>>();

  const factsOf = (mbid: string) => {
    if (!artistCache.has(mbid)) {
      artistCache.set(
        mbid,
        musicBrainz.lookupArtist(mbid).then(
          (a) => ({ country: a.country, lifeSpan: a.lifeSpan }),
          () => null,
        ),
      );
    }
    return artistCache.get(mbid)!;
  };
  const membersOf = (mbid: string) => {
    if (!membersCache.has(mbid)) {
      membersCache.set(
        mbid,
        musicBrainz.lookupBandMembers(mbid).catch(() => null),
      );
    }
    return membersCache.get(mbid)!;
  };

  return {
    async check(rec: { artist: string; musicbrainzArtistId?: string }, constraints: GoldenConstraints): Promise<ConstraintCheck> {
      const mbid = rec.musicbrainzArtistId;
      if (!mbid) return { verdict: "unknown", failed: [] };

      const needsFacts =
        constraints.country !== undefined ||
        constraints.formedFrom !== undefined ||
        constraints.formedUntil !== undefined ||
        constraints.ended !== undefined;
      const base: ArtistFacts | null = needsFacts ? await factsOf(mbid) : { country: null, lifeSpan: { ended: false } };
      if (!base) return { verdict: "unknown", failed: [] };

      const shared = constraints.sharesMemberWith;
      if (!shared) return checkConstraints(constraints, base);

      const [referenceMembers, ownMembers] = await Promise.all([membersOf(shared.mbid), membersOf(mbid)]);
      const facts: ArtistFacts = { ...base, members: ownMembers ?? undefined };
      const reference = referenceMembers ? { members: referenceMembers, isReference: mbid === shared.mbid } : null;
      return checkConstraints(constraints, facts, reference);
    },
  };
}
