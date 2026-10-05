import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { externalLookupsFor } from "../src/recommendationPipeline.js";

test("without a replay directory the research graph uses the network as usual", () => {
  const lookups = externalLookupsFor({});
  assert.equal(lookups.replay, false);
  assert.equal(lookups.fetchImpl, undefined);
  assert.equal(lookups.musicBrainzMinIntervalMs, undefined, "the MusicBrainz client keeps its own 1 req/s gate");
});

test("with a replay directory, lookups are recorded and MusicBrainz is only throttled on real calls", () => {
  const lookups = externalLookupsFor({ evalReplayDir: mkdtempSync(join(tmpdir(), "replay-")) });
  assert.equal(lookups.replay, true);
  assert.equal(typeof lookups.fetchImpl, "function");
  assert.equal(lookups.musicBrainzMinIntervalMs, 0, "the replaying fetch spaces real MusicBrainz calls instead");
});
