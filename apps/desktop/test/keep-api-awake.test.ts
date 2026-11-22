import test from "node:test";
import assert from "node:assert/strict";

import { keepApiAwake } from "../src/keepApiAwake.js";

const MINUTE = 60_000;

/** The app in use at a fake clock; `pings` lists the URLs asked for. */
function appInUse(apiBaseUrl = "https://api.example") {
  let time = 0;
  const pings: string[] = [];
  const listeners = new Map<string, () => void>();
  let tick: () => void = () => {};
  const document = {
    visibilityState: "visible",
    addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
  };
  keepApiAwake({
    apiBaseUrl,
    fetchImpl: async (url) => { pings.push(String(url)); throw new Error("asleep"); },
    document,
    setIntervalImpl: (handler) => { tick = handler; },
    now: () => time,
  });
  return {
    pings,
    document,
    fire: (type: string) => listeners.get(type)?.(),
    /** Time passes; the ten-minute timer fires as it would. */
    wait: (minutes: number) => {
      for (let m = 1; m <= minutes; m++) {
        time += MINUTE;
        if (time % (10 * MINUTE) === 0) tick();
      }
    },
    listening: () => listeners.size > 0,
  };
}

test("a hosted API is kept awake while the app is used", () => {
  const app = appInUse();
  app.wait(9);
  assert.equal(app.pings.length, 0);
  app.wait(1);
  assert.deepEqual(app.pings, ["https://api.example/health"]);
});

test("an app nobody uses lets the API sleep, and the first key wakes it before a message is sent", () => {
  const app = appInUse();
  app.wait(120);
  const whileAway = app.pings.length;
  assert.equal(whileAway, 2, "only within half an hour of the last use");
  app.fire("keydown");
  assert.equal(app.pings.length, whileAway + 1);
  app.fire("keydown");
  app.fire("pointerdown");
  assert.equal(app.pings.length, whileAway + 1, "once is enough");
});

test("a hidden window does not keep the API awake; coming back wakes it", () => {
  const app = appInUse();
  app.document.visibilityState = "hidden";
  app.wait(20);
  app.fire("visibilitychange");
  assert.equal(app.pings.length, 0);
  app.document.visibilityState = "visible";
  app.fire("visibilitychange");
  assert.equal(app.pings.length, 1);
});

test("the local sidecar needs no waking", () => {
  for (const local of ["http://localhost:3001", "http://127.0.0.1:3001", "http://localhost"]) {
    assert.equal(appInUse(local).listening(), false, local);
  }
  assert.equal(appInUse("https://localhost.example").listening(), true);
});

test("without a document (tests, server rendering) there is nothing to do", () => {
  keepApiAwake({ apiBaseUrl: "https://api.example", fetchImpl: fetch, document: undefined });
});
