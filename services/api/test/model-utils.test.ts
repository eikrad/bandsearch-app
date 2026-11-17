import { test } from "node:test";
import assert from "node:assert/strict";

import { invokeModel, parseModelJsonResponse, withTimeout, type ChatModelClient } from "../src/agent/modelUtils.js";

// ── parseModelJsonResponse ─────────────────────────────────────────────────

test("parseModelJsonResponse parses clean JSON object", () => {
  const result = parseModelJsonResponse('{"artist":"Alcest","why":"Atmospheric"}');
  assert.deepEqual(result, { artist: "Alcest", why: "Atmospheric" });
});

test("parseModelJsonResponse parses clean JSON array", () => {
  const result = parseModelJsonResponse('[{"artist":"Alcest"},{"artist":"Deafheaven"}]');
  assert.deepEqual(result, [{ artist: "Alcest" }, { artist: "Deafheaven" }]);
});

test("parseModelJsonResponse strips markdown code fences", () => {
  const result = parseModelJsonResponse('```json\n{"artist":"Alcest"}\n```');
  assert.deepEqual(result, { artist: "Alcest" });
});

test("parseModelJsonResponse extracts first JSON object from text with preamble", () => {
  const result = parseModelJsonResponse('Here are my picks: {"recommendations":[{"artist":"Alcest"}]}');
  assert.deepEqual(result, { recommendations: [{ artist: "Alcest" }] });
});

test("parseModelJsonResponse extracts JSON array from text with preamble", () => {
  const result = parseModelJsonResponse('Sure! [{"artist":"Alcest"}] enjoy!');
  assert.deepEqual(result, [{ artist: "Alcest" }]);
});

test("parseModelJsonResponse throws on unparseable input", () => {
  assert.throws(
    () => parseModelJsonResponse("not json at all"),
    /invalid recommendation output/,
  );
});

// ── withTimeout ────────────────────────────────────────────────────────────

test("withTimeout resolves when promise settles before timeout", async () => {
  const result = await withTimeout(Promise.resolve("ok"), 1000);
  assert.equal(result, "ok");
});

test("withTimeout rejects when timeout fires first", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 200));
  await assert.rejects(withTimeout(slow, 10), /timeout/i);
});

// ── invokeModel ────────────────────────────────────────────────────────────

const prompt = [{ role: "user", content: "hi" }];

test("invokeModel forwards the cancellation signal to the model", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const client: ChatModelClient = { invoke: async (_prompt, options) => { received = options?.signal; return { content: "ok" }; } };
  const response = await invokeModel(client, prompt, { signal: controller.signal, timeoutMs: 1000, timeoutMessage: "node timeout" });
  assert.equal(response.content, "ok");
  assert.equal(received, controller.signal);
});

test("invokeModel never starts a call once the run is cancelled", async () => {
  const controller = new AbortController();
  controller.abort(new Error("research deadline"));
  let calls = 0;
  const client: ChatModelClient = { invoke: async () => { calls++; return { content: "late" }; } };
  await assert.rejects(invokeModel(client, prompt, { signal: controller.signal, timeoutMs: 1000, timeoutMessage: "node timeout" }), /research deadline/);
  assert.equal(calls, 0);
});

test("invokeModel rejects with the caller's message when the model outlives its cap", async () => {
  const client: ChatModelClient = { invoke: () => new Promise(() => {}) };
  await assert.rejects(invokeModel(client, prompt, { timeoutMs: 10, timeoutMessage: "planner timeout" }), /planner timeout/);
});

test("parseModelJsonResponse ignores a reasoning model's <think> block", () => {
  const raw = '<think>Maybe {"draft": true}? No.</think>\n{"final": 1}';
  assert.deepEqual(parseModelJsonResponse(raw), { final: 1 });
});

test("parseModelJsonResponse ignores reasoning whose opening <think> tag is missing", () => {
  // A known Scaleway bug can drop the opening tag; the answer follows the last </think>.
  const raw = 'weighing {"draft": true} first</think>{"final": 2}';
  assert.deepEqual(parseModelJsonResponse(raw), { final: 2 });
});
