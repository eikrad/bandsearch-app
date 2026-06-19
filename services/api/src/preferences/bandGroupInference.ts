export type GroupLike = { id: string; name: string };

export type BandLike = {
  id: unknown;
  musicbrainzArtistId: unknown;
};

export type InferenceContext = {
  lookupArtist: (mbid: string) => Promise<{ genres: string[] }>;
  createGroup: (name: string, userId?: string) => Promise<{ ok: boolean; group?: GroupLike }>;
  addArtistToGroup: (groupId: string, savedBandId: string, userId?: string) => Promise<{ ok: boolean }>;
};

export async function inferAndApplyGroupAssignments(
  bands: BandLike[],
  existingGroups: GroupLike[],
  context: InferenceContext,
  userId?: string,
): Promise<void> {
  const groupByName = new Map<string, GroupLike>(existingGroups.map((g) => [g.name, g]));

  for (const band of bands) {
    const mbid = typeof band.musicbrainzArtistId === "string" ? band.musicbrainzArtistId : null;
    if (!mbid) continue;

    let artistData: { genres: string[] };
    try {
      artistData = await context.lookupArtist(mbid);
    } catch {
      continue;
    }

    for (const genre of artistData.genres ?? []) {
      if (!groupByName.has(genre)) {
        const createResult = await context.createGroup(genre, userId);
        if (!createResult.ok || !createResult.group) continue;
        groupByName.set(genre, createResult.group);
      }

      const group = groupByName.get(genre);
      if (group && typeof band.id === "string") {
        await context.addArtistToGroup(group.id, band.id, userId);
      }
    }
  }
}
