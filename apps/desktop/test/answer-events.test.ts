import test from "node:test";
import assert from "node:assert/strict";

import { progressLabel, readAnswerEvents, type ReadAnswerEvent } from "../src/answerEvents.js";
import { createChatClient, BandsearchHttpError } from "../src/chatClient.js";
import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { createChatAppModel } from "../src/chatAppModel.js";
import type { AnswerEvent } from "../../../shared/schemas/src/contracts.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
import { frame, jobNotFound, liveSseResponse, sseResponse } from "./helpers/fakeSearchJobApi.js";

const done = { type: "done", response: { recommendations: [{ artist: "Fen" }], assistantReply: "Try Fen.", meta: { turn: "search" } } };
const noSleep = async () => {};

type Call = { url: string; method: string; headers: Headers };

/** A client against an API whose job is followed by `follow`, one call per attempt. */
function clientFollowing(follow: (call: Call, attempt: number) => Response | Promise<Response>, options: { sleep?: (ms: number) => Promise<void>; stallMs?: number } = {}) {
  const calls: Call[] = [];
  let attempts = 0;
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    sleep: options.sleep ?? noSleep,
    stallMs: options.stallMs,
    fetchImpl: async (url, init) => {
      const call = { url: String(url), method: init?.method ?? "GET", headers: new Headers(init?.headers) };
      calls.push(call);
      if (call.method === "POST") return jsonResponse({ jobId: "job-1" }, { status: 202 });
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      return follow(call, attempts++);
    },
  });
  return { client, calls, gets: () => calls.filter((c) => c.method === "GET") };
}

test("events are read whole however the network cuts them, accents and ids included", async () => {
  const raw = new TextEncoder().encode(frame({ type: "reply", text: "Møl" }, 3) + ": keep-alive\n\n" + frame({ type: "reply", text: "Møl, then Fen" }));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of raw) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const events: ReadAnswerEvent[] = [];
  for await (const event of readAnswerEvents(body)) events.push(event);
  assert.deepEqual(events, [
    { id: 3, event: { type: "reply", text: "Møl" } },
    { id: null, event: { type: "reply", text: "Møl, then Fen" } },
  ]);
});

test("a search is started as a job and followed to its answer", async () => {
  const events: AnswerEvent[] = [];
  const { client, calls } = clientFollowing(() =>
    sseResponse([frame({ type: "progress", progress: { stage: "thinking" } }, 1), frame({ type: "reply", text: "Try" }, 2), frame(done, 3)]));

  const jobId = await client.startSearch({ query: "blackgaze", obscurityTarget: "underground" });
  const result = await client.followSearch(jobId, { onEvent: (e) => events.push(e) }).result;

  assert.equal(jobId, "job-1");
  assert.equal(calls[0]!.url, "http://localhost:3001/recommendations/jobs");
  assert.equal(calls[1]!.url, "http://localhost:3001/recommendations/jobs/job-1");
  assert.equal(calls[1]!.headers.get("accept"), "text/event-stream");
  assert.deepEqual(events.map((e) => e.type), ["progress", "reply"]);
  assert.equal(result.assistantReply, "Try Fen.");
});

test("a stream that drops is picked up again where it broke off, without an error", async () => {
  const events: AnswerEvent[] = [];
  const { client, gets } = clientFollowing((_call, attempt) => attempt === 0
    ? sseResponse([frame({ type: "progress", progress: { stage: "thinking" } }, 4)])
    : sseResponse([frame({ type: "progress", progress: { stage: "choosing", candidates: 3 } }, 5), frame(done, 6)]));

  const result = await client.followSearch("job-1", { onEvent: (e) => events.push(e) }).result;

  assert.equal(result.assistantReply, "Try Fen.");
  assert.equal(gets().length, 2);
  assert.match(gets()[1]!.url, /\?after=4$/);
  assert.deepEqual(events.map((e) => e.type), ["progress", "progress"]);
});

test("while the network is gone it tries again a few times, waiting longer each time, then says the connection dropped", async () => {
  const waits: number[] = [];
  const { client, gets } = clientFollowing(() => { throw new TypeError("fetch failed"); }, { sleep: async (ms) => { waits.push(ms); } });

  await assert.rejects(client.followSearch("job-1", {}).result, (error: unknown) => {
    assert.ok(error instanceof BandsearchHttpError);
    assert.equal(error.code, "search_disconnected");
    return true;
  });
  assert.equal(gets().length, waits.length + 1);
  assert.ok(waits.length >= 3 && waits.length <= 6, "a small, bounded number of tries");
  assert.ok(waits.every((ms, i) => i === 0 || ms > waits[i - 1]!), "each wait longer than the last");
  assert.ok(waits.reduce((a, b) => a + b, 0) <= 30_000, "given up within half a minute");
});

test("a server error while following is retried too: the server may be restarting", async () => {
  const { client } = clientFollowing((_call, attempt) => attempt === 0
    ? jsonResponse({}, { status: 502 })
    : sseResponse([frame(done, 1)]));
  assert.equal((await client.followSearch("job-1", {}).result).assistantReply, "Try Fen.");
});

test("a job the server does not know is a lost search, at once", async () => {
  const { client, gets } = clientFollowing(() => jobNotFound());
  await assert.rejects(client.followSearch("job-1", {}).result, (error: unknown) => {
    assert.ok(error instanceof BandsearchHttpError);
    assert.equal(error.code, "search_lost");
    assert.equal(error.status, 404);
    return true;
  });
  assert.equal(gets().length, 1, "nothing to try again");
});

test("a search stopped elsewhere is reported, not dropped", async () => {
  const { client } = clientFollowing(() => sseResponse([frame({ type: "cancelled" }, 2)]));
  await assert.rejects(client.followSearch("job-1", {}).result, (error: unknown) =>
    error instanceof BandsearchHttpError && error.code === "search_cancelled");
});

test("an error at the end of a job is the same error as an HTTP one", async () => {
  const { client } = clientFollowing(() => sseResponse([
    frame({ type: "progress", progress: { stage: "thinking" } }, 1),
    frame({ type: "error", status: 502, error: { code: "search_unavailable", message: "down" } }, 2),
  ]));
  await assert.rejects(client.followSearch("job-1", {}).result, (error: unknown) => {
    assert.ok(error instanceof BandsearchHttpError);
    assert.equal(error.code, "search_unavailable");
    assert.equal(error.status, 502);
    return true;
  });
});

test("a stream that goes quiet is taken for dead and re-attached", async () => {
  const { client, gets } = clientFollowing((_call, attempt) => attempt === 0
    ? liveSseResponse(null).response
    : sseResponse([frame(done, 1)]), { stallMs: 20 });
  assert.equal((await client.followSearch("job-1", {}).result).assistantReply, "Try Fen.");
  assert.equal(gets().length, 2);
});

test("reconnecting drops a connection that may be dead and attaches again at once", async () => {
  let first!: ReturnType<typeof liveSseResponse>;
  const { client, gets } = clientFollowing(() => {
    if (gets().length === 1) {
      first = liveSseResponse(null);
      first.send({ type: "progress", progress: { stage: "thinking" } }, 1);
      return first.response;
    }
    return sseResponse([frame(done, 2)]);
  });
  const following = client.followSearch("job-1", {});
  await new Promise((resolve) => setTimeout(resolve, 5));
  following.reconnect();

  assert.equal((await following.result).assistantReply, "Try Fen.");
  assert.match(gets()[1]!.url, /\?after=1$/);
});

test("stopping while following ends it quietly as an abort", async () => {
  const controller = new AbortController();
  const { client } = clientFollowing(() => liveSseResponse(controller.signal).response);
  const following = client.followSearch("job-1", { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(following.result, (error: unknown) => (error as Error).name === "AbortError");
});

test("stopping a search asks the API to cancel its job", async () => {
  const { client, calls } = clientFollowing(() => sseResponse([]));
  await client.stopSearch("job-1");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ["DELETE http://localhost:3001/recommendations/jobs/job-1"]);
});

/** The chat on a hand-fed job stream: `send` delivers an event, then the screen state can be read. */
function liveChat() {
  let live!: ReturnType<typeof liveSseResponse>;
  const app = bootstrapDesktopApp({
    fetchImpl: async (url, init) => {
      const address = String(url);
      if (address.endsWith("/recommendations/jobs")) return jsonResponse({ jobId: "job-1" }, { status: 202 });
      if (address.includes("/recommendations/jobs/")) {
        live = liveSseResponse(init?.signal);
        return live.response;
      }
      return jsonResponse({ session: { id: "s" }, message: {} });
    },
    pendingSearch: { get: () => null, set: () => {}, clear: () => {} },
  });
  const chat = createChatAppModel({ app });
  let notified = 0;
  chat.subscribe(() => { notified += 1; });
  const answer = chat.submitQuery("bands like Alcest");
  let id = 0;
  const send = async (event: unknown) => {
    await new Promise((r) => setTimeout(r, 5));
    live.send(event, ++id);
    await new Promise((r) => setTimeout(r, 5));
  };
  return { chat, send, answer, notified: () => notified };
}

test("the chat shows the progress and the reply as it is written, and the cards with the answer", async () => {
  const { chat, send, answer, notified } = liveChat();

  await send({ type: "progress", progress: { stage: "searching", anchorArtists: ["Alcest"] } });
  assert.equal(progressLabel(chat.getProgress()), "Looking for bands near Alcest…");
  assert.equal(chat.getConversation()!.length, 1, "no reply yet");

  await send({ type: "reply", text: "Try Fe" });
  assert.deepEqual(chat.getConversation()!.at(-1), { id: "assistant-1", role: "assistant", content: "Try Fe", cards: [] });

  await send({ type: "progress", progress: { stage: "searchingAgain" } });
  assert.equal(chat.getConversation()!.length, 1, "a reply that led nowhere leaves the screen");

  await send(done);
  await answer;
  const last = chat.getConversation()!.at(-1)!;
  assert.equal(last.id, "assistant-1", "the finished message takes the place of the one being written");
  assert.equal(last.content, "Try Fen.");
  assert.equal(last.role === "assistant" && last.cards.length, 1);
  assert.equal(chat.getProgress(), null);
  assert.equal(notified(), 3);
});

test("a failed answer leaves no half-written reply behind", async () => {
  const { chat, send, answer } = liveChat();
  const failed = assert.rejects(answer);
  await send({ type: "reply", text: "Try Fe" });
  await send({ type: "error", status: 502, error: { code: "recommendation_unavailable", message: "down" } });
  await failed;
  assert.deepEqual(chat.getConversation()!.map((m) => m.role), ["user"]);
});

test("the progress line names at most three reference artists and covers every stage", () => {
  assert.equal(progressLabel(null), "Sending your message…");
  assert.equal(progressLabel({ stage: "thinking" }), "Thinking…");
  assert.equal(progressLabel({ stage: "searching", anchorArtists: ["A", "B", "C", "D"] }), "Looking for bands near A, B and C…");
  assert.equal(progressLabel({ stage: "searching", anchorArtists: [] }), "Searching the web…");
  assert.equal(progressLabel({ stage: "checking", found: 0 }), "Checking what turned up…");
  assert.equal(progressLabel({ stage: "searchingAgain" }), "Too few good matches yet, searching once more…");
  assert.equal(progressLabel({ stage: "choosing", candidates: 12 }), "Choosing the best matches…");
});
