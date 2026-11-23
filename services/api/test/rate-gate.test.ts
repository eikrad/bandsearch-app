import test from "node:test";
import assert from "node:assert/strict";

import { createRateGate } from "../src/integrations/rateGate.js";

test("the gate spaces starts but does not wait for slow work to finish", async () => {
  const gate = createRateGate();
  const startedAt: number[] = [];
  let finishSlow!: () => void;
  const slow = gate.schedule(20, () => {
    startedAt.push(Date.now());
    return new Promise<void>((resolve) => { finishSlow = resolve; });
  });
  await gate.schedule(20, async () => { startedAt.push(Date.now()); });
  assert.equal(startedAt.length, 2, "the second request started while the first was still open");
  assert.ok(startedAt[1]! - startedAt[0]! >= 15);
  finishSlow();
  await slow;
});

test("work cancelled while it waits never starts and does not hold up the next", async () => {
  const gate = createRateGate();
  const started: string[] = [];
  await gate.schedule(30, async () => { started.push("first"); });
  const controller = new AbortController();
  const cancelled = gate.schedule(30, async () => { started.push("cancelled"); }, controller.signal);
  const next = gate.schedule(30, async () => { started.push("next"); });
  controller.abort(new Error("research deadline"));
  await assert.rejects(cancelled);
  await next;
  assert.deepEqual(started, ["first", "next"]);
});

test("work that fails does not block the gate", async () => {
  const gate = createRateGate();
  await assert.rejects(gate.schedule(5, async () => { throw new Error("down"); }), /down/);
  assert.equal(await gate.schedule(5, async () => "up"), "up");
});

test("a clock that jumped back cannot stretch the wait beyond one interval", async (t) => {
  const gate = createRateGate();
  await gate.schedule(20, async () => undefined);
  t.mock.method(Date, "now", () => 1_000);
  assert.equal(await gate.schedule(20, async () => "started"), "started");
});
