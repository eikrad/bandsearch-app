import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrivacyPolicyView } from "../src/ui/PrivacyPolicyView.js";

function render() {
  return renderToStaticMarkup(React.createElement(PrivacyPolicyView, { handlers: { onBack: () => {} } }));
}

test("the privacy policy names every third party that receives user data", () => {
  const html = render();

  // Brave's ToS §3b makes the query-text disclosure contractually mandatory on
  // top of the GDPR duty, so this test exists to keep it from being edited out.
  for (const processor of ["Gemini", "Brave", "MusicBrainz", "Last.fm", "Turso"]) {
    assert.match(html, new RegExp(processor), `the policy must name ${processor}`);
  }
});

test("the privacy policy states how long data is kept and how to delete it", () => {
  const html = render();

  assert.match(html, /90 days/, "the stated retention period is visible");
  assert.match(html, /delete/i, "the policy explains how to exercise erasure");
});

test("the privacy policy states the minimum age", () => {
  const html = render();

  assert.match(html, /\b16\b/, "a minimum age is stated");
});

test("the privacy policy explains the profiling it performs", () => {
  const html = render();

  assert.match(html, /taste profile|profil/i, "the taste profile and its logic are disclosed");
});

test("a reader can get back out of the privacy policy", () => {
  const html = render();

  assert.match(html, /Back/i, "there is a way back to the app");
});
