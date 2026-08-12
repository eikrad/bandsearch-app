import test from "node:test";
import assert from "node:assert/strict";
import { checkEvidence } from "../../src/eval/evidenceChecker.js";

test("checkEvidence: citationSupportRate = 1.0 when all URLs in why appear in signals", () => {
  const why = "Great band. See https://bandcamp.com/xyz and https://rym.xyz/artist for evidence.";
  const signals = ["https://bandcamp.com/xyz", "https://rym.xyz/artist", "agent_reasoning"];
  const report = checkEvidence(why, signals);
  assert.equal(report.citationSupportRate, 1.0);
});

test("checkEvidence: citationSupportRate = 0.0 when URL in why is not in signals", () => {
  const why = "Check https://fabricated-url.com/made-up for more.";
  const signals = ["https://bandcamp.com/xyz"];
  const report = checkEvidence(why, signals);
  assert.equal(report.citationSupportRate, 0.0);
});

test("checkEvidence: citationSupportRate = 1.0 when why contains no URLs (vacuously supported)", () => {
  const why = "An amazing band with a unique drone sound.";
  const signals = ["https://bandcamp.com/xyz"];
  const report = checkEvidence(why, signals);
  assert.equal(report.citationSupportRate, 1.0);
});

test("checkEvidence: partial citationSupportRate when only some why URLs appear in signals", () => {
  const why = "Hear https://bandcamp.com/xyz and also https://unknown-blog.com/post";
  const signals = ["https://bandcamp.com/xyz", "agent_reasoning"];
  const report = checkEvidence(why, signals);
  assert.equal(report.citationSupportRate, 0.5);
});

test("checkEvidence: genericWhyFlag = true when why contains a known generic phrase", () => {
  const why = "This band is known for their unique sound and wide influences.";
  const signals = [];
  const report = checkEvidence(why, signals);
  assert.equal(report.genericWhyFlag, true);
});

test("checkEvidence: genericWhyFlag = false when why is specific and descriptive", () => {
  const why = "Recorded their 2019 debut in a Finnish cabin on analog tape; WIRE magazine gave them 4 stars.";
  const signals = [];
  const report = checkEvidence(why, signals);
  assert.equal(report.genericWhyFlag, false);
});

test("checkEvidence: genericWhyFlag = true for 'similar to' phrasing", () => {
  const why = "If you enjoy Deafheaven you will love this band, similar to their blackgaze style.";
  const signals = [];
  const report = checkEvidence(why, signals);
  assert.equal(report.genericWhyFlag, true);
});

test("checkEvidence: genericWhyFlag is case-insensitive", () => {
  const why = "KNOWN FOR THEIR heavy riffs.";
  const signals = [];
  const report = checkEvidence(why, signals);
  assert.equal(report.genericWhyFlag, true);
});
