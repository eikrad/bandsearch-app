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
  assert.equal(asksLastFmFirst("blackgaze", "obscure"), false);
  for (const target of ["cult", "underground", undefined]) assert.equal(asksLastFmFirst("blackgaze", target), true);
});

test("a demand that similarity cannot show goes to the web: vocals, lyrics, instruments, labels", () => {
  for (const query of [
    "melancholic synthwave with female vocals", "Dreamy blackgaze, clean VOCALS.", "folk metal sung in Finnish", "doom with a violin or cello",
    "bands on the label Prophecy Productions", "post-punk with German lyrics", "synthpop mit Sängerin", "doom metal med kvindelig vokal",
  ]) assert.equal(asksLastFmFirst(query, "cult"), false, query);
});

test("genre, mood, country, era and members are no such demands", () => {
  for (const query of [
    "instrumental post-rock bands from Japan", "pagan folk metal with authentic traditional instruments", "bands like Slowdive but more electronic",
    "dreamy shoegaze bands that only formed after 2015", "other bands that members of Alcest play in", "harsh and harping noise rock", "labelled as doom",
  ]) assert.equal(asksLastFmFirst(query, "cult"), true, query);
});
