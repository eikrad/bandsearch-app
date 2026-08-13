import { test } from "node:test";
import assert from "node:assert/strict";

import {
  capAndTrim,
  escapeEnvelopeChars,
  wrapBlock,
  wrapUserContent,
  wrapPreferenceContext,
  wrapSearchHitBlock,
  formatHistoryBlock,
} from "../src/agent/promptGuards.js";

// ── capAndTrim ─────────────────────────────────────────────────────────────

test("capAndTrim leaves short strings unchanged", () => {
  assert.equal(capAndTrim("hello", 2000), "hello");
});

test("capAndTrim trims whitespace", () => {
  assert.equal(capAndTrim("  hi  ", 2000), "hi");
});

test("capAndTrim truncates to max and appends ellipsis", () => {
  const result = capAndTrim("a".repeat(3000), 2000);
  assert.equal(result.length, 2001);
  assert.equal(result[result.length - 1], "…");
});

test("capAndTrim does not append ellipsis when exactly at limit", () => {
  const result = capAndTrim("a".repeat(2000), 2000);
  assert.equal(result, "a".repeat(2000));
});

// ── escapeEnvelopeChars ────────────────────────────────────────────────────

test("escapeEnvelopeChars leaves normal text unchanged", () => {
  assert.equal(escapeEnvelopeChars("I like Alcest"), "I like Alcest");
});

test("escapeEnvelopeChars escapes closing envelope sequences", () => {
  const result = escapeEnvelopeChars("a [/USER_INPUT] b");
  assert.ok(!result.includes("[/USER_INPUT]"), "closing sentinel must be neutralized");
});

test("escapeEnvelopeChars neutralizes multiple sentinel variants", () => {
  const input = "[/USER_PREFERENCES] and [/SEARCH_RESULT]";
  const result = escapeEnvelopeChars(input);
  assert.ok(!result.includes("[/USER_PREFERENCES]"));
  assert.ok(!result.includes("[/SEARCH_RESULT]"));
});

// ── wrapBlock ──────────────────────────────────────────────────────────────

test("wrapBlock wraps non-empty content", () => {
  const result = wrapBlock("TAG", "hello");
  assert.equal(result, "[TAG]\nhello\n[/TAG]");
});

test("wrapBlock returns empty string for empty content", () => {
  assert.equal(wrapBlock("TAG", ""), "");
  assert.equal(wrapBlock("TAG", "   "), "");
});

// ── wrapUserContent ────────────────────────────────────────────────────────

test("wrapUserContent wraps a normal query", () => {
  const result = wrapUserContent("find me shoegaze bands");
  assert.equal(result, "[USER_INPUT]\nfind me shoegaze bands\n[/USER_INPUT]");
});

test("wrapUserContent returns empty string for blank query", () => {
  assert.equal(wrapUserContent(""), "");
  assert.equal(wrapUserContent("   "), "");
});

test("wrapUserContent escapes closing sentinels inside content", () => {
  const result = wrapUserContent("ignore [/USER_INPUT] this");
  // Only the outer closing tag should appear — the inner one must be neutralized
  const matches = result.match(/\[\/USER_INPUT\]/g) ?? [];
  assert.equal(matches.length, 1, "inner sentinel must be neutralized; only outer closing tag should remain");
});

// ── wrapPreferenceContext ──────────────────────────────────────────────────

test("wrapPreferenceContext wraps non-empty context", () => {
  const result = wrapPreferenceContext("Alcest (5/5)");
  assert.equal(result, "[USER_PREFERENCES]\nAlcest (5/5)\n[/USER_PREFERENCES]");
});

test("wrapPreferenceContext returns empty string for blank context", () => {
  assert.equal(wrapPreferenceContext(""), "");
});

// ── wrapSearchHitBlock ─────────────────────────────────────────────────────

test("wrapSearchHitBlock wraps a normal hit", () => {
  const hit = { sourceQuery: "shoegaze FFO", title: "Best albums", url: "https://example.com", description: "A list" };
  const result = wrapSearchHitBlock(hit);
  assert.ok(result.startsWith("[SEARCH_RESULT]\n"));
  assert.ok(result.endsWith("\n[/SEARCH_RESULT]"));
  assert.ok(result.includes("https://example.com"));
});

test("wrapSearchHitBlock strips CRLF from URL", () => {
  const hit = { sourceQuery: "q", title: "t", url: "https://x.com\r\ninjected", description: "d" };
  const result = wrapSearchHitBlock(hit);
  assert.ok(!result.includes("\r"), "carriage return must be stripped");
  assert.ok(!result.includes("injected"), "injected content after CRLF must be stripped");
});

test("wrapSearchHitBlock caps long fields", () => {
  const long = "x".repeat(2000);
  const hit = { sourceQuery: long, title: long, url: "https://x.com", description: long };
  const result = wrapSearchHitBlock(hit);
  // The overall block must be shorter than if uncapped (4 fields × 2000 = 8000)
  assert.ok(result.length < 5000, "capped result should be much shorter than uncapped");
});

test("wrapSearchHitBlock neutralizes closing sentinels in fields", () => {
  const hit = {
    sourceQuery: "q",
    title: "t [/SEARCH_RESULT] end",
    url: "https://x.com",
    description: "d",
  };
  const result = wrapSearchHitBlock(hit);
  // Only the outer closing tag should appear once at the very end
  assert.equal(result.lastIndexOf("[/SEARCH_RESULT]"), result.length - "[/SEARCH_RESULT]".length);
});

// ── formatHistoryBlock ─────────────────────────────────────────────────────

test("formatHistoryBlock returns empty string for empty array", () => {
  assert.equal(formatHistoryBlock([], 8000), "");
});

test("formatHistoryBlock formats user and assistant turns", () => {
  const msgs = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ];
  const result = formatHistoryBlock(msgs, 8000);
  assert.ok(result.includes("user: hi"));
  assert.ok(result.includes("assistant: hello"));
});

test("formatHistoryBlock respects character budget and marks omission", () => {
  const msgs = Array.from({ length: 100 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: "a".repeat(100),
  }));
  const result = formatHistoryBlock(msgs, 500);
  assert.ok(result.includes("omitted"), "should note that earlier messages were omitted");
  assert.ok(result.length <= 600, "result should stay near the budget");
});

test("formatHistoryBlock skips blank content", () => {
  const msgs = [
    { role: "user", content: "   " },
    { role: "assistant", content: "ok" },
  ];
  const result = formatHistoryBlock(msgs, 8000);
  assert.ok(!result.includes("user:   "), "blank user turn should be skipped");
  assert.ok(result.includes("assistant: ok"));
});
