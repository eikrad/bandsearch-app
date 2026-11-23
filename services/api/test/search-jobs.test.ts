import { test } from "node:test";
import assert from "node:assert/strict";

import { createSearchJobs, type SearchJobEvent, type SearchJobWork } from "../src/searchJobs/searchJobs.js";

const FAILURE = { status: 502, code: "recommendation_unavailable", message: "recommendation service unavailable" };

/** A job whose steps the test drives: emit events, then finish or fail it. */
function controllableWork() {
  let emit!: Parameters<SearchJobWork>[0]["emit"];
  let signal!: AbortSignal;
  let finish!: (response: unknown) => void;
  let fail!: (error: unknown) => void;
  const work: SearchJobWork = (job) => {
    emit = job.emit;
    signal = job.signal;
    return new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  };
  return {
    work,
    emit: (event: Parameters<typeof emit>[0]) => emit(event),
    signal: () => signal,
    finish: async (response: unknown) => { finish(response); await settle(); },
    fail: async (error: unknown) => { fail(error); await settle(); },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function jobsWithClock(options: Partial<Parameters<typeof createSearchJobs>[0]> = {}) {
  let time = Date.parse("2026-11-23T12:00:00.000Z");
  const timers: Array<{ run: () => void; at: number; cleared: boolean }> = [];
  const jobs = createSearchJobs({
    describeFailure: () => FAILURE,
    now: () => time,
    schedule: (run, ms) => {
      const timer = { run, at: time + ms, cleared: false };
      timers.push(timer);
      return () => { timer.cleared = true; };
    },
    ...options,
  });
  return {
    jobs,
    advance(ms: number) {
      time += ms;
      for (const timer of timers) if (!timer.cleared && timer.at <= time) { timer.cleared = true; timer.run(); }
    },
  };
}

function collect(jobs: ReturnType<typeof createSearchJobs>, id: string, owner: string, after = 0) {
  const events: SearchJobEvent[] = [];
  const unfollow = jobs.follow(id, owner, after, (event) => events.push(event));
  return { events, unfollow, types: () => events.map((e) => e.event.type) };
}

test("a follower sees a job's progress as it happens and its result at the end", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  const followed = collect(jobs, id, "ana");

  run.emit({ type: "progress", progress: { stage: "thinking" } });
  await run.finish({ recommendations: [{ artist: "Fen" }] });

  assert.deepEqual(followed.events.map((e) => e.event), [
    { type: "progress", progress: { stage: "thinking" } },
    { type: "done", response: { recommendations: [{ artist: "Fen" }] } },
  ]);
  assert.equal(jobs.get(id, "ana")?.status, "done");
});

test("a follower who comes back later gets what it missed, then what follows", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  run.emit({ type: "progress", progress: { stage: "thinking" } });
  run.emit({ type: "progress", progress: { stage: "searching", anchorArtists: ["Alcest"] } });

  const late = collect(jobs, id, "ana");
  assert.deepEqual(late.types(), ["progress", "progress"]);

  // Resuming after the first event skips it.
  const resumed = collect(jobs, id, "ana", late.events[0]!.id);
  assert.deepEqual(resumed.events.map((e) => e.event), [
    { type: "progress", progress: { stage: "searching", anchorArtists: ["Alcest"] } },
  ]);

  await run.finish({ recommendations: [] });
  assert.deepEqual(late.types(), ["progress", "progress", "done"]);
  assert.deepEqual(resumed.types(), ["progress", "done"]);
  assert.ok(late.events.every((e, i, all) => i === 0 || e.id > all[i - 1]!.id), "ids only grow");
});

test("attaching to a finished job replays all of it, ending with the result", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  run.emit({ type: "progress", progress: { stage: "thinking" } });
  await run.finish({ recommendations: [] });

  assert.deepEqual(collect(jobs, id, "ana").types(), ["progress", "done"]);
});

test("a follower that leaves hears nothing more, and the job runs on without it", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  const gone = collect(jobs, id, "ana");
  gone.unfollow?.();

  run.emit({ type: "progress", progress: { stage: "thinking" } });
  await run.finish({ recommendations: [] });

  assert.deepEqual(gone.events, []);
  assert.equal(run.signal().aborted, false, "leaving does not cancel");
  assert.equal(jobs.get(id, "ana")?.status, "done");
});

test("the reply is kept as its latest text: a long answer does not pile up a copy per token", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  run.emit({ type: "progress", progress: { stage: "choosing", candidates: 9 } });
  const live = collect(jobs, id, "ana");
  for (const text of ["T", "Tr", "Try", "Try Fen."]) run.emit({ type: "reply", text });

  assert.deepEqual(collect(jobs, id, "ana").events.map((e) => e.event), [
    { type: "progress", progress: { stage: "choosing", candidates: 9 } },
    { type: "reply", text: "Try Fen." },
  ]);
  assert.equal(live.events.length, 5, "a live follower still sees each reply");
  // Resuming after an older reply brings the newest one.
  assert.deepEqual(collect(jobs, id, "ana", live.events[1]!.id).events.map((e) => e.event), [{ type: "reply", text: "Try Fen." }]);
});

test("a job is its owner's alone: to anyone else it does not exist", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);

  assert.equal(jobs.get(id, "bo"), undefined);
  assert.equal(jobs.follow(id, "bo", 0, () => {}), undefined);
  assert.equal(jobs.cancel(id, "bo"), false);
  assert.equal(run.signal().aborted, false);
  assert.equal(jobs.get(id, "ana")?.status, "running");
});

test("job ids are 128 random bits, never repeated", () => {
  const { jobs } = jobsWithClock();
  const ids = new Set(Array.from({ length: 50 }, (_, i) => jobs.start(`owner-${i}`, () => new Promise(() => {}))));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{22}$/);
});

test("stopping a job aborts its work and tells its followers", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  const followed = collect(jobs, id, "ana");

  assert.equal(jobs.cancel(id, "ana"), true);
  await run.fail(run.signal().reason);

  assert.equal(run.signal().aborted, true);
  assert.deepEqual(followed.types(), ["cancelled"]);
  assert.equal(jobs.get(id, "ana")?.status, "cancelled");
  assert.equal(jobs.cancel(id, "ana"), true, "stopping it again is harmless");
});

test("a work that finishes after it was stopped does not turn into a result", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  jobs.cancel(id, "ana");
  await run.finish({ recommendations: [{ artist: "Fen" }] });

  assert.equal(jobs.get(id, "ana")?.status, "cancelled");
  assert.deepEqual(collect(jobs, id, "ana").types(), ["cancelled"]);
});

test("a new search cancels the same user's running one, and nobody else's", async () => {
  const { jobs } = jobsWithClock();
  const first = controllableWork();
  const other = controllableWork();
  const firstId = jobs.start("ana", first.work);
  const otherId = jobs.start("bo", other.work);

  const secondId = jobs.start("ana", controllableWork().work);

  assert.notEqual(secondId, firstId);
  assert.equal(first.signal().aborted, true);
  assert.equal(jobs.get(firstId, "ana")?.status, "cancelled");
  assert.equal(jobs.get(secondId, "ana")?.status, "running");
  assert.equal(other.signal().aborted, false);
  assert.equal(jobs.get(otherId, "bo")?.status, "running");
});

test("a job that fails ends with the public error its failure maps to", async () => {
  const seen: unknown[] = [];
  const { jobs } = jobsWithClock({ describeFailure: (error) => { seen.push(error); return FAILURE; } });
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  const followed = collect(jobs, id, "ana");
  const cause = new Error("upstream detail");
  await run.fail(cause);

  assert.deepEqual(seen, [cause]);
  assert.deepEqual(followed.events.at(-1)?.event, { type: "error", status: 502, error: { code: FAILURE.code, message: FAILURE.message } });
  assert.deepEqual(jobs.get(id, "ana"), { status: "failed", progress: null, reply: "", error: FAILURE });
});

test("where a job stands, for a client that polls", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  run.emit({ type: "progress", progress: { stage: "choosing", candidates: 4 } });
  run.emit({ type: "reply", text: "Try Fen." });
  assert.deepEqual(jobs.get(id, "ana"), { status: "running", progress: { stage: "choosing", candidates: 4 }, reply: "Try Fen." });

  await run.finish({ recommendations: [] });
  assert.deepEqual(jobs.get(id, "ana"), {
    status: "done", progress: { stage: "choosing", candidates: 4 }, reply: "Try Fen.", response: { recommendations: [] },
  });
});

test("a finished job is kept for an hour, then forgotten", async () => {
  const { jobs, advance } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  await run.finish({ recommendations: [] });

  advance(59 * 60 * 1000);
  assert.equal(jobs.get(id, "ana")?.status, "done");
  advance(2 * 60 * 1000);
  assert.equal(jobs.get(id, "ana"), undefined);
  assert.equal(jobs.follow(id, "ana", 0, () => {}), undefined);
});

test("a job nobody collects still ends: past its deadline it is stopped and fails", async () => {
  const { jobs, advance } = jobsWithClock({ maxRunMs: 5 * 60 * 1000 });
  const run = controllableWork();
  const id = jobs.start("ana", run.work);

  advance(5 * 60 * 1000);
  await run.fail(run.signal().reason);

  assert.equal(run.signal().aborted, true);
  assert.equal(jobs.get(id, "ana")?.status, "failed");
});

test("when full, the oldest finished jobs go first; running ones stay", async () => {
  const { jobs, advance } = jobsWithClock({ maxJobs: 3 });
  const running = jobs.start("runner", () => new Promise(() => {}));
  const finished: string[] = [];
  for (const owner of ["a", "b", "c"]) {
    advance(1000);
    finished.push(jobs.start(owner, async () => ({ recommendations: [] })));
    await settle();
  }

  assert.equal(jobs.get(running, "runner")?.status, "running");
  assert.equal(jobs.get(finished[0]!, "a"), undefined, "the oldest finished job made room");
  assert.equal(jobs.get(finished[1]!, "b")?.status, "done");
  assert.equal(jobs.get(finished[2]!, "c")?.status, "done");
});

test("a job keeps a bounded number of events, and always its end", async () => {
  const { jobs } = jobsWithClock({ maxEventsPerJob: 3 });
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  for (let i = 0; i < 10; i++) run.emit({ type: "progress", progress: { stage: "checking", found: i } });
  await run.finish({ recommendations: [] });

  const replay = collect(jobs, id, "ana").types();
  assert.equal(replay.length, 4);
  assert.equal(replay.at(-1), "done");
});

test("forgetting a user stops and drops their jobs", async () => {
  const { jobs } = jobsWithClock();
  const run = controllableWork();
  const id = jobs.start("ana", run.work);
  const kept = jobs.start("bo", () => new Promise(() => {}));

  jobs.forgetOwner("ana");

  assert.equal(run.signal().aborted, true);
  assert.equal(jobs.get(id, "ana"), undefined);
  assert.equal(jobs.get(kept, "bo")?.status, "running");
});


test("a full store refuses another owner before starting work but allows replacement", () => {
  const { jobs } = jobsWithClock({ maxJobs: 1 });
  const first = controllableWork();
  const id = jobs.start("ana", first.work);
  let started = false;
  assert.throws(() => jobs.start("bo", async () => { started = true; }), /capacity/i);
  assert.equal(started, false);
  assert.equal(first.signal().aborted, false);
  assert.equal(jobs.get(id, "ana")?.status, "running");
  const replacement = jobs.start("ana", controllableWork().work);
  assert.equal(first.signal().aborted, true);
  assert.equal(jobs.get(id, "ana"), undefined);
  assert.equal(jobs.get(replacement, "ana")?.status, "running");
});

for (const beforeSettlement of [true, false]) {
  test(`replacement ${beforeSettlement ? 'before' : 'after'} completion settlement never gets the old answer`, async () => {
    const { jobs } = jobsWithClock();
    const first = controllableWork();
    const id = jobs.start("ana", first.work);
    const finishing = first.finish("old answer");
    if (!beforeSettlement) await finishing;
    const second = controllableWork();
    const next = jobs.start("ana", second.work);
    await finishing;
    assert.equal(jobs.get(id, "ana")?.status, beforeSettlement ? "cancelled" : "done");
    assert.equal(jobs.get(next, "ana")?.response, undefined);
    await second.finish("new answer");
    assert.equal(jobs.get(next, "ana")?.response, "new answer");
  });

  test(`following ${beforeSettlement ? 'before' : 'after'} completion settlement gets exactly one terminal event`, async () => {
    const { jobs } = jobsWithClock();
    const run = controllableWork();
    const id = jobs.start("ana", run.work);
    const finishing = run.finish("answer");
    if (!beforeSettlement) await finishing;
    const followed = collect(jobs, id, "ana");
    await finishing;
    assert.deepEqual(followed.types(), ["done"]);
  });
}

for (const ending of ["done", "cancelled", "failed"] as const) {
  test(`${ending} clears its deadline and later completion attempts cannot change it`, async () => {
    let active = 0;
    let expire = () => {};
    const { jobs, advance } = jobsWithClock({
      keepFinishedMs: 10,
      schedule: (run) => { active++; expire = run; return () => { active--; }; },
    });
    const run = controllableWork();
    const id = jobs.start("ana", run.work);
    const followed = collect(jobs, id, "ana");
    if (ending === "done") await run.finish("answer");
    else if (ending === "cancelled") jobs.cancel(id, "ana");
    else expire();
    await run.finish("late answer");
    await run.fail(new Error("late rejection"));
    run.emit({ type: "reply", text: "late reply" });
    assert.equal(active, 0);
    assert.deepEqual(followed.types(), [ending === "failed" ? "error" : ending]);
    assert.equal(jobs.get(id, "ana")?.status, ending);
    assert.equal(jobs.cancel(id, "ana"), true);
    assert.equal(jobs.get(id, "ana")?.status, ending);
    advance(10);
    assert.equal(jobs.get(id, "ana"), undefined);
    assert.equal(jobs.follow(id, "ana", 0, () => {}), undefined);
    assert.equal(jobs.cancel(id, "ana"), false);
  });
}
