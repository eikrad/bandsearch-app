import { test } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../src/app.js";
import { createStorage } from "../src/storage/createStorage.js";
import type { TurnListener } from "../src/agent/conversation/conversationService.js";
import type { EvalEventContext } from "../src/eval/evalWorker.js";
import { assertRecord } from "./helpers/typeAssertions.js";

type Pipeline = NonNullable<Parameters<typeof createApp>[0]>["recommendationPipeline"];
type Sent = { status: number; data: Record<string, unknown>; headers: Headers };
type StreamedEvent = { id: number | null; event: Record<string, unknown> };

const quiet = { warn: () => {}, error: () => {} };

/** A pipeline the test drives: it reports what the test says and answers when told. */
function heldPipeline() {
  const calls: Array<{ request: Record<string, unknown>; listener: TurnListener }> = [];
  const answers: Array<(value: { recommendations: unknown[]; assistantReply: string; meta: Record<string, unknown> }) => void> = [];
  const failures: Array<(error: unknown) => void> = [];
  const pipeline: NonNullable<Pipeline> = {
    recommend: (request, listener) => new Promise((resolve, reject) => {
      calls.push({ request, listener: listener ?? {} });
      answers.push(resolve);
      failures.push(reject);
      listener?.signal?.addEventListener("abort", () => reject(listener.signal!.reason as Error));
    }),
  };
  return {
    pipeline,
    calls,
    listener: (i = calls.length - 1) => calls[i]!.listener,
    answer: (reply = "Try Fen.", i = answers.length - 1) =>
      answers[i]!({ recommendations: [{ artist: "Fen" }], assistantReply: reply, meta: { turn: "search", model: "m" } }),
    fail: (error: unknown, i = failures.length - 1) => failures[i]!(error),
  };
}

async function withServer(app: ReturnType<typeof createApp>, run: (base: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function client(base: string, token?: string) {
  const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Sent> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...auth, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const data: unknown = text ? JSON.parse(text) : {};
    assertRecord(data);
    return { status: response.status, data, headers: response.headers };
  }
  return {
    send,
    async start(body: unknown = { query: "blackgaze" }) {
      const sent = await send("POST", "/recommendations/jobs", body);
      assert.equal(sent.status, 202, JSON.stringify(sent.data));
      return String(sent.data.jobId);
    },
    /** Opens the job's event stream; `take` reads until `until` says stop, then hangs up. */
    async follow(jobId: string, { after, lastEventId, until }: { after?: number; lastEventId?: number; until?: (events: StreamedEvent[]) => boolean } = {}) {
      const controller = new AbortController();
      const response = await fetch(`${base}/recommendations/jobs/${jobId}${after === undefined ? "" : `?after=${after}`}`, {
        headers: { accept: "text/event-stream", ...auth, ...(lastEventId === undefined ? {} : { "last-event-id": String(lastEventId) }) },
        signal: controller.signal,
      });
      const events: StreamedEvent[] = [];
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        return { status: response.status, events, body: await response.text() };
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let unread = "";
      try {
        for (;;) {
          if (until?.(events)) break;
          const { done, value } = await reader.read();
          if (done) break;
          unread += value;
          for (let end = unread.indexOf("\n\n"); end !== -1; end = unread.indexOf("\n\n")) {
            const lines = unread.slice(0, end).split("\n");
            unread = unread.slice(end + 2);
            const data = lines.find((l) => l.startsWith("data: "));
            if (!data) continue;
            const id = lines.find((l) => l.startsWith("id: "));
            events.push({ id: id ? Number(id.slice(4)) : null, event: JSON.parse(data.slice(6)) as Record<string, unknown> });
          }
        }
      } finally {
        controller.abort();
      }
      return { status: response.status, events, body: "" };
    },
  };
}

const types = (events: StreamedEvent[]) => events.map((e) => e.event.type);
const until = (n: number) => (events: StreamedEvent[]) => events.length >= n;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a search starts as a job: its id comes back at once, and following it ends in the answer", async () => {
  const held = heldPipeline();
  const processed: EvalEventContext[] = [];
  const app = createApp({ recommendationPipeline: held.pipeline, evalWorker: { processEvent: async (c) => { processed.push(c); } } });
  await withServer(app, async (base) => {
    const api = client(base);
    const started = await api.send("POST", "/recommendations/jobs", { query: "blackgaze", obscurityTarget: "underground" });
    assert.equal(started.status, 202);
    const jobId = String(started.data.jobId);
    assert.equal(started.headers.get("location"), `/recommendations/jobs/${jobId}`);
    assert.equal(held.calls[0]!.request.obscurityTarget, "underground");

    held.listener().onProgress?.({ stage: "thinking" });
    const following = api.follow(jobId);
    await tick();
    held.answer();
    const { events } = await following;

    assert.deepEqual(types(events), ["progress", "done"]);
    assert.ok(events.every((e) => typeof e.id === "number"), "every event carries an id to resume after");
    const response = events.at(-1)!.event.response as { assistantReply: string; meta: Record<string, unknown> };
    assert.equal(response.assistantReply, "Try Fen.");
    assert.equal(response.meta.aiGenerated, true);
    assert.equal(response.meta.model, "m");
    await tick();
    assert.equal(processed.length, 1, "eval scores the finished batch once");
    assert.equal(processed[0]!.eventId, response.meta.eventId);
    assert.equal(processed[0]!.obscurityTarget, "underground");
  });
});

test("a dropped stream does not cancel the search, and coming back replays what was missed", async () => {
  const held = heldPipeline();
  await withServer(createApp({ recommendationPipeline: held.pipeline }), async (base) => {
    const api = client(base);
    const jobId = await api.start();
    held.listener().onProgress?.({ stage: "thinking" });

    const first = await api.follow(jobId, { until: until(1) });
    assert.deepEqual(types(first.events), ["progress"]);
    await tick();
    assert.equal(held.listener().signal?.aborted, false, "hanging up is not stopping");

    held.listener().onProgress?.({ stage: "searching", anchorArtists: ["Alcest"] });
    held.answer();
    await tick();

    const byHeader = await api.follow(jobId, { lastEventId: first.events[0]!.id! });
    assert.deepEqual(types(byHeader.events), ["progress", "done"]);
    assert.deepEqual(byHeader.events[0]!.event.progress, { stage: "searching", anchorArtists: ["Alcest"] });
    const byQuery = await api.follow(jobId, { after: first.events[0]!.id! });
    assert.deepEqual(types(byQuery.events), ["progress", "done"]);
    assert.deepEqual(types((await api.follow(jobId)).events), ["progress", "progress", "done"], "from the start, it all");
  });
});

test("a client that cannot stream polls the job's state", async () => {
  const held = heldPipeline();
  await withServer(createApp({ recommendationPipeline: held.pipeline }), async (base) => {
    const api = client(base);
    const jobId = await api.start();
    held.listener().onProgress?.({ stage: "choosing", candidates: 6 });
    held.listener().onReply?.("Try");

    const running = await api.send("GET", `/recommendations/jobs/${jobId}`);
    assert.equal(running.status, 200);
    assert.deepEqual(running.data, { jobId, status: "running", progress: { stage: "choosing", candidates: 6 }, reply: "Try" });

    held.answer();
    await tick();
    const done = await api.send("GET", `/recommendations/jobs/${jobId}`);
    assert.equal(done.data.status, "done");
    assertRecord(done.data.response);
    assert.equal(done.data.response.assistantReply, "Try Fen.");
  });
});

test("Stop cancels the search; whoever follows it hears that it was stopped", async () => {
  const held = heldPipeline();
  await withServer(createApp({ recommendationPipeline: held.pipeline }), async (base) => {
    const api = client(base);
    const jobId = await api.start();
    const following = api.follow(jobId);
    await tick();

    const stopped = await api.send("DELETE", `/recommendations/jobs/${jobId}`);
    assert.equal(stopped.status, 204);
    assert.equal(held.listener().signal?.aborted, true);
    assert.deepEqual(types((await following).events), ["cancelled"]);
    assert.equal((await api.send("GET", `/recommendations/jobs/${jobId}`)).data.status, "cancelled");
  });
});

test("a new search stops the user's previous one", async () => {
  const held = heldPipeline();
  await withServer(createApp({ recommendationPipeline: held.pipeline }), async (base) => {
    const api = client(base);
    const first = await api.start({ query: "blackgaze" });
    const second = await api.start({ query: "slowcore" });

    assert.equal(held.listener(0).signal?.aborted, true);
    assert.equal(held.listener(1).signal?.aborted, false);
    assert.equal((await api.send("GET", `/recommendations/jobs/${first}`)).data.status, "cancelled");
    assert.equal((await api.send("GET", `/recommendations/jobs/${second}`)).data.status, "running");
  });
});

test("a job the server does not know, as after a restart, is a 404 the app reads as a lost search", async () => {
  await withServer(createApp({ recommendationPipeline: heldPipeline().pipeline }), async (base) => {
    const api = client(base);
    const unknown = "AAAAAAAAAAAAAAAAAAAAAA";
    for (const method of ["GET", "DELETE"]) {
      const sent = await api.send(method, `/recommendations/jobs/${unknown}`);
      assert.equal(sent.status, 404);
      assert.deepEqual(sent.data, { error: { code: "search_job_not_found", message: "search job not found" } });
    }
    const streamed = await api.follow(unknown);
    assert.equal(streamed.status, 404);
    assert.match(streamed.body, /search_job_not_found/);
  });
});

test("someone else's job answers exactly like a missing one", async () => {
  const held = heldPipeline();
  const storage = createStorage();
  try {
    const app = createApp({ storage, recommendationPipeline: held.pipeline, runtimeConfig: { jwtSecret: "search-jobs-route-test-secret" } });
    await withServer(app, async (base) => {
      const anon = client(base);
      const one = await anon.send("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
      const two = await anon.send("POST", "/auth/register", { email: "two@example.com", displayName: "Two", password: "pw" });
      const owner = client(base, String(one.data.token));
      const stranger = client(base, String(two.data.token));
      const jobId = await owner.start();

      const missing = await stranger.send("GET", "/recommendations/jobs/AAAAAAAAAAAAAAAAAAAAAA");
      for (const method of ["GET", "DELETE"]) {
        const sent = await stranger.send(method, `/recommendations/jobs/${jobId}`);
        assert.equal(sent.status, missing.status);
        assert.deepEqual(sent.data, missing.data);
      }
      assert.equal((await stranger.follow(jobId)).status, 404);
      assert.equal(held.listener().signal?.aborted, false, "the stranger could not stop it");

      // Their own search does not stop someone else's either.
      await stranger.start();
      assert.equal(held.listener(0).signal?.aborted, false);
      assert.equal((await owner.send("GET", `/recommendations/jobs/${jobId}`)).data.status, "running");
    });
  } finally {
    await storage.close();
  }
});

test("deleting the account stops its running search", async () => {
  const held = heldPipeline();
  const storage = createStorage();
  try {
    const app = createApp({ storage, recommendationPipeline: held.pipeline, runtimeConfig: { jwtSecret: "search-jobs-route-test-secret" } });
    await withServer(app, async (base) => {
      const registered = await client(base).send("POST", "/auth/register", { email: "one@example.com", displayName: "One", password: "pw" });
      const api = client(base, String(registered.data.token));
      await api.start();
      assert.equal((await api.send("POST", "/account/delete", { password: "pw" })).status, 200);
      assert.equal(held.listener().signal?.aborted, true);
    });
  } finally {
    await storage.close();
  }
});

test("a failed search ends with the same public error a held request gets, and its cause is logged", async () => {
  const held = heldPipeline();
  const errors: Array<Record<string, unknown>> = [];
  const app = createApp({ recommendationPipeline: held.pipeline, logger: { warn: () => {}, error: (o) => errors.push(o) } });
  await withServer(app, async (base) => {
    const api = client(base);
    const jobId = await api.start();
    held.fail(new Error("secret upstream detail"));
    await tick();

    const { events } = await api.follow(jobId);
    assert.deepEqual(events.at(-1)!.event, {
      type: "error", status: 502, error: { code: "recommendation_unavailable", message: "recommendation service unavailable" },
    });
    const polled = await api.send("GET", `/recommendations/jobs/${jobId}`);
    assert.deepEqual(polled.data.error, { status: 502, code: "recommendation_unavailable", message: "recommendation service unavailable" });
    assert.doesNotMatch(JSON.stringify(polled.data), /secret/);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.event, "recommendation_failed");
    assert.match(String(errors[0]!.error), /secret upstream detail/);
  });
});

test("an invalid question is refused before any job starts", async () => {
  const held = heldPipeline();
  await withServer(createApp({ recommendationPipeline: held.pipeline }), async (base) => {
    const refused = await client(base).send("POST", "/recommendations/jobs", { query: "" });
    assert.equal(refused.status, 400);
    assert.equal((refused.data.error as Record<string, unknown>).code, "validation_error");
    assert.equal(held.calls.length, 0);
  });
});

test("the rate limit counts searches started, not following or polling them", async () => {
  await withServer(createApp({ recommendationPipeline: heldPipeline().pipeline, logger: quiet }), async (base) => {
    const api = client(base);
    const jobId = await api.start();
    for (let i = 0; i < 40; i++) assert.equal((await api.send("GET", `/recommendations/jobs/${jobId}`)).status, 200);
    let last = 0;
    for (let i = 0; i < 30; i++) last = (await api.send("POST", "/recommendations/jobs", { query: "blackgaze" })).status;
    assert.equal(last, 429);
  });
});

test("a finished job can be collected for an hour, then it is gone", async () => {
  let time = Date.parse("2026-11-23T12:00:00.000Z");
  const held = heldPipeline();
  const app = createApp({ recommendationPipeline: held.pipeline, searchJobs: { now: () => time } });
  await withServer(app, async (base) => {
    const api = client(base);
    const jobId = await api.start();
    held.answer();
    await tick();

    time += 59 * 60 * 1000;
    assert.equal((await api.send("GET", `/recommendations/jobs/${jobId}`)).data.status, "done");
    time += 2 * 60 * 1000;
    assert.equal((await api.send("GET", `/recommendations/jobs/${jobId}`)).status, 404);
  });
});

test("the request log never carries a whole job id", async () => {
  const logged: string[] = [];
  const original = console.log;
  console.log = (line: unknown) => { logged.push(String(line)); };
  try {
    await withServer(createApp({ recommendationPipeline: heldPipeline().pipeline }), async (base) => {
      const api = client(base);
      const jobId = await api.start();
      await api.send("GET", `/recommendations/jobs/${jobId}`);
      const encodedId = [...jobId].map((char) => `%${char.charCodeAt(0).toString(16)}`).join("");
      await api.send("GET", `/recommendations/jobs/${encodedId}`);
      assert.equal((await api.send("GET", `/RECOMMENDATIONS/JOBS/${jobId}`)).status, 200);
      await api.send("DELETE", `/recommendations/jobs/${jobId}`);
      await tick();
      assert.ok(logged.every((line) => !line.includes(encodedId)), "encoded ids must also be redacted");
      assert.ok(logged.some((line) => line.includes("/recommendations/jobs/")), "the requests are logged");
      assert.ok(logged.every((line) => !line.includes(jobId)), "but not the id they name");
    });
  } finally {
    console.log = original;
  }
});


test("both start routes refuse a full store with a retryable public error", async () => {
  const held = heldPipeline();
  await withServer(createApp({ recommendationPipeline: held.pipeline, searchJobs: { maxJobs: 0 } }), async (base) => {
    for (const path of ["/recommendations/jobs", "/recommendations"]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "blackgaze" }), signal: AbortSignal.timeout(1000),
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: {
        code: "search_capacity_exceeded", message: "Search capacity is full. Please try again in a moment.",
      } });
    }
    assert.equal(held.calls.length, 0);
  });
});


test("resuming at or beyond a finished job's final event closes the stream", async () => {
  const held = heldPipeline();
  await withServer(createApp({ recommendationPipeline: held.pipeline }), async (base) => {
    const api = client(base);
    const jobId = await api.start();
    held.answer();
    await tick();
    const complete = await api.follow(jobId);
    const lastId = complete.events.at(-1)!.id!;
    for (const cursor of [lastId, lastId + 100]) {
      for (const header of [false, true]) {
        const response = await fetch(`${base}/recommendations/jobs/${jobId}${header ? "" : `?after=${cursor}`}`, {
          headers: { accept: "text/event-stream", ...(header ? { "last-event-id": String(cursor) } : {}) },
          signal: AbortSignal.timeout(1000),
        });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), "");
      }
    }
  });
});
