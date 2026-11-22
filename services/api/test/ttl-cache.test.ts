import test from "node:test";
import assert from "node:assert/strict";

import { createTtlCache } from "../src/integrations/ttlCache.js";

test("an entry is forgotten after its time to live", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const cache = createTtlCache<string>({ ttlMs: 100, maxEntries: 10 });
  cache.set("a", "value");
  t.mock.timers.setTime(99);
  assert.equal(cache.get("a"), "value");
  t.mock.timers.setTime(100);
  assert.equal(cache.get("a"), undefined);
});

test("a full cache forgets its oldest entry; writing an entry again makes it the newest", () => {
  const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 3);
  cache.set("c", 4);
  assert.deepEqual([cache.get("a"), cache.get("b"), cache.get("c")], [3, undefined, 4]);
});
