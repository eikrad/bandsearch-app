import test from "node:test";
import assert from "node:assert/strict";

import { asksLastFmFirst, enoughFromLastFm, ENOUGH_IN_RANGE, ENOUGH_VERIFIED } from "../../src/agent/research/lastFmFirst.js";
import type { VerifiedCandidate } from "../../src/agent/research/candidateVerifier.js";

function bands(count: number, overrides: Partial<VerifiedCandidate> = {}): VerifiedCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `Band ${i}`, verified: true, listenerCount: 20_000, evidenceUrls: [], evidenceSnippets: [], sourceQueries: [], ...overrides,
  }));
}

test("enough means enough verified bands inside the requested range", () => {
  assert.equal(enoughFromLastFm(bands(ENOUGH_IN_RANGE), "underground"), true);
  assert.equal(enoughFromLastFm(bands(ENOUGH_IN_RANGE - 1), "underground"), false);
  assert.equal(enoughFromLastFm(bands(30, { listenerCount: 60_000 }), "underground"), false, "near misses are not in range");
  assert.equal(enoughFromLastFm(bands(30, { verified: false }), "underground"), false);
});

test("a band without a count does not pass as obscure: Last.fm named it, so the lookup failed", () => {
  assert.equal(enoughFromLastFm(bands(30, { listenerCount: null }), "obscure"), false);
  assert.equal(enoughFromLastFm([...bands(30, { listenerCount: null }), ...bands(2, { listenerCount: 900 })], "obscure"), false);
});

test("without a target, verified bands are enough", () => {
  assert.equal(enoughFromLastFm(bands(ENOUGH_VERIFIED, { listenerCount: null }), undefined), true);
  assert.equal(enoughFromLastFm(bands(ENOUGH_VERIFIED - 1), undefined), false);
});

test("Last.fm is not asked first for the smallest acts, which its lists hardly know", () => {
  assert.equal(asksLastFmFirst("obscure"), false);
  for (const target of ["cult", "underground", undefined]) assert.equal(asksLastFmFirst(target), true);
});
