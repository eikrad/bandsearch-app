import test from "node:test";
import assert from "node:assert/strict";

import { progressLabel, readAnswerEvents } from "../src/answerEvents.js";
import { createChatClient, BandsearchHttpError } from "../src/chatClient.js";
import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { createChatAppModel } from "../src/chatAppModel.js";
import type { AnswerEvent } from "../../../shared/schemas/src/contracts.js";
import { jsonResponse } from "./helpers/fakeResponse.js";

function bytes(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

function streamResponse(chunks: string[]): Response {
  return new Response(bytes(chunks), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

const done = { type: "done", response: { recommendations: [{ artist: "Fen" }], assistantReply: "Try Fen.", meta: { turn: "search" } } };

test("events are read whole however the network cuts them, accents included", async () => {
  const raw = new TextEncoder().encode(frame({ type: "reply", text: "Møl" }) + frame({ type: "reply", text: "Møl, then Fen" }));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of raw) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  const events: AnswerEvent[] = [];
  for await (const event of readAnswerEvents(body)) events.push(event);
  assert.deepEqual(events, [{ type: "reply", text: "Møl" }, { type: "reply", text: "Møl, then Fen" }]);
});

test("the client follows a streamed answer and returns its final response", async () => {
  let accept: string | null = null;
  const events: AnswerEvent[] = [];
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async (_url, init) => {
      accept = new Headers(init?.headers).get("accept");
      return streamResponse([frame({ type: "progress", progress: { stage: "thinking" } }), frame({ type: "reply", text: "Try" }), frame(done)]);
    },
  });
  const result = await client.fetchRecommendations({ query: "blackgaze", onEvent: (e) => events.push(e) });
  assert.equal(accept, "text/event-stream");
  assert.deepEqual(events.map((e) => e.type), ["progress", "reply"]);
  assert.equal(result.assistantReply, "Try Fen.");
});

test("a plain JSON answer is accepted from an API that does not stream", async () => {
  const client = createChatClient({ apiBaseUrl: "http://localhost:3001", fetchImpl: async () => jsonResponse({ assistantReply: "Hi" }) });
  assert.equal((await client.fetchRecommendations({ query: "hi", onEvent: () => {} })).assistantReply, "Hi");
});

test("an error at the end of a stream is the same error as an HTTP one", async () => {
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async () => streamResponse([
      frame({ type: "progress", progress: { stage: "thinking" } }),
      frame({ type: "error", status: 502, error: { code: "search_unavailable", message: "down" } }),
    ]),
  });
  await assert.rejects(client.fetchRecommendations({ query: "x", onEvent: () => {} }), (error: unknown) => {
    assert.ok(error instanceof BandsearchHttpError);
    assert.equal(error.code, "search_unavailable");
    assert.equal(error.status, 502);
    return true;
  });
});

test("a stream that breaks off is an error, not an empty answer", async () => {
  const client = createChatClient({
    apiBaseUrl: "http://localhost:3001",
    fetchImpl: async () => streamResponse([frame({ type: "reply", text: "Try" })]),
  });
  await assert.rejects(client.fetchRecommendations({ query: "x", onEvent: () => {} }), /broke off/);
});

/** The chat on a hand-fed stream: `send` delivers an event, then the screen state can be read. */
function liveChat() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
  const app = bootstrapDesktopApp({
    fetchImpl: async (url) => String(url).endsWith("/recommendations")
      ? new Response(body, { headers: { "content-type": "text/event-stream" } })
      : jsonResponse({ session: { id: "s" }, message: {} }),
  });
  const chat = createChatAppModel({ app });
  let notified = 0;
  chat.subscribe(() => { notified += 1; });
  const answer = chat.submitQuery("bands like Alcest");
  const send = async (event: unknown) => {
    controller.enqueue(new TextEncoder().encode(frame(event)));
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
