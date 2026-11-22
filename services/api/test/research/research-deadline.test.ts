import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

import { createChatModelFactory } from "../../src/llm/chatModel.js";
import { invokeResearchGraph } from "../../src/agent/research/researchGraph.js";
import type { ChatModelClient } from "../../src/agent/modelUtils.js";
import { fakeFetch, fakeModelClient, graphDeps } from "../helpers/researchGraphHarness.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Sends the ranker's prompt to `ranker` and every other node's prompt to `others`. */
function rankerVia(ranker: ChatModelClient, others: ChatModelClient): ChatModelClient {
  return {
    invoke: (prompt, options) => prompt[0]?.content.startsWith("You recommend niche bands")
      ? ranker.invoke(prompt, options)
      : others.invoke(prompt, options),
  };
}

const input = { userQuery: "obscure blackgaze", preferenceContext: "", messages: [], mode: "fresh" as const };

async function flushGraph() {
  for (let i = 0; i < 10; i++) await setImmediate();
}

test("the research deadline aborts a stalled ranker and settles the run within the total budget", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const started = deferred();
  let rankSignal: AbortSignal | undefined;
  const { client: answers } = fakeModelClient();
  const client: ChatModelClient = {
    async invoke(prompt, options) {
      if (prompt[0]?.content.startsWith("You recommend niche bands")) {
        rankSignal = options?.signal;
        started.resolve();
        return new Promise(() => {}); // An uncooperative transport must not hold the response open.
      }
      return answers.invoke(prompt);
    },
  };
  const { fetchImpl } = fakeFetch({});
  let settled = false;
  const result = invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl, researchTimeoutMs: 3000 }), input)
    .then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
  await started.promise;
  try {
    t.mock.timers.tick(3000);
    await flushGraph();
    assert.equal(settled, true, "the configured deadline also includes final ranking");
    assert.equal(rankSignal?.aborted, true, "the model receives cancellation");
    assert.match(String(await result), /timeout/);
  } finally {
    t.mock.timers.tick(20_000);
    await result;
  }
});

test("verification keeps completed candidates, cancels a stalled batch and leaves time for ranking", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const stalled = deferred();
  const requests: string[] = [];
  let batchSignal: AbortSignal | null | undefined;
  const { client, calls } = fakeModelClient({
    extract: () => ({ candidates: ["Fen", "Ghost Bath", "Third Band"].map((name) => ({
      name, hits: [1],
    })) }),
    rank: () => ({ reply: "Found Fen.", recommendations: [{ artist: "Fen", why: "See https://blog.example/discovery", sourceSignals: [] }] }),
  });
  const fetchImpl: typeof fetch = async (url, init) => {
    const address = String(url);
    requests.push(address);
    if (address.includes("api.search.brave.com")) {
      return Response.json({ web: { results: [{ title: "Discoveries", url: "https://blog.example/discovery", description: "Fen and more" }] } });
    }
    if (address.includes("alias")) {
      // The second batch: the names the first one missed.
      batchSignal = init?.signal;
      stalled.resolve();
      return new Promise(() => {});
    }
    if (address.includes("musicbrainz.org")) return Response.json({ artists: [{ id: "fen", name: "Fen", score: 100 }] });
    throw new Error(`Unexpected request: ${address}`);
  };
  let settled = false;
  const result = invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl, lastFmApiKey: "lastfm", musicBrainzMinIntervalMs: 0 }), input)
    .then((value) => { settled = true; return value; });
  // Attach a handler before advancing time, including on the failing implementation.
  const outcome = result.catch((error: unknown) => error);
  await stalled.promise;
  try {
    t.mock.timers.tick(48_000);
    await flushGraph();
    assert.equal(settled, true, "research stops at 48 seconds, preserving the 12-second ranking reserve");
    assert.equal(batchSignal?.aborted, true);
    const value = await result;
    assert.equal(value.pipelineDiagnostics.verifiedCount, 1);
    assert.equal(value.recommendations.length, 1);
    assert.equal(calls.filter((call) => call.system.startsWith("You evaluate")).length, 0);
    assert.match(calls.find((call) => call.system.startsWith("You recommend"))?.user ?? "", /artist: Fen/);
  } finally {
    t.mock.timers.tick(60_000);
    await outcome;
  }
});

test("a ranker retry shares the original ranking cap and receives cancellation through the model factory", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const retryStarted = deferred();
  const { client: answers } = fakeModelClient();
  let rankCalls = 0;
  let retrySignal: AbortSignal | undefined;
  const client: ChatModelClient = {
    async invoke(prompt, options) {
      if (!prompt[0]?.content.startsWith("You recommend niche bands")) return answers.invoke(prompt);
      rankCalls++;
      if (rankCalls === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
        // The ranker retries an answer whose artist has no attributable evidence.
        return { content: JSON.stringify({ recommendations: [{ artist: "Unknown", why: "Try this", sourceSignals: [] }] }) };
      }
      retrySignal = options?.signal;
      retryStarted.resolve();
      return new Promise(() => {});
    },
  };
  const { fetchImpl } = fakeFetch({});
  let settled = false;
  const outcome = invokeResearchGraph(graphDeps({ chatModel: () => client, fetchImpl }), input)
    .then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
  await firstStarted.promise;
  t.mock.timers.tick(10_000);
  releaseFirst.resolve();
  await retryStarted.promise;
  try {
    t.mock.timers.tick(2000);
    await flushGraph();
    assert.equal(settled, true, "retrying must not restart the 12-second ranking cap");
    assert.equal(retrySignal?.aborted, true);
    assert.match(String(await outcome), /timeout/);
    t.mock.timers.tick(60_000);
    await flushGraph();
    assert.equal(rankCalls, 2, "cancelled work cannot start another model call");
  } finally {
    t.mock.timers.tick(60_000);
    await outcome;
  }
});

test("Last.fm enrichment is cancelled at the research cutoff while confirmed evidence still reaches ranking", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const started = deferred();
  const signals: Array<AbortSignal | null | undefined> = [];
  const { client } = fakeModelClient({
    extract: () => ({ candidates: [{ name: "Fen", hits: [1] }] }),
    rank: () => ({ reply: "Try Fen.", recommendations: [{ artist: "Fen", why: "See https://blog.example/fen", sourceSignals: [] }] }),
  });
  const { fetchImpl: answers } = fakeFetch({
    brave: () => ({ web: { results: [{ title: "Fen", url: "https://blog.example/fen", description: "Try Fen" }] } }),
    musicbrainz: () => ({ artists: [{ id: "fen", name: "Fen", score: 100 }] }),
  });
  const fetchImpl: typeof fetch = async (url, init) => {
    if (!String(url).includes("audioscrobbler.com")) return answers(url, init);
    signals.push(init?.signal);
    if (String(url).includes("getinfo")) started.resolve();
    return new Promise(() => {});
  };
  let settled = false;
  const result = invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl, lastFmApiKey: "lastfm", researchTimeoutMs: 3000, musicBrainzMinIntervalMs: 0 }), input)
    .then((value) => { settled = true; return value; });
  const outcome = result.catch((error: unknown) => error);
  await started.promise;
  await flushGraph(); // Verification finishes; only Last.fm is still open.
  try {
    t.mock.timers.tick(2000);
    await flushGraph();
    assert.equal(settled, true);
    assert.equal(signals.length, 2, "similar artists and listener counts were requested");
    assert.ok(signals.every((signal) => signal?.aborted));
    assert.equal((await result).recommendations.length, 1);
  } finally {
    t.mock.timers.tick(20_000);
    await outcome;
  }
});

test("deadline cancellation stops Brave retries and skips later research nodes", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const started = deferred();
  const { client, calls } = fakeModelClient();
  let fetchCalls = 0;
  let signal: AbortSignal | null | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    fetchCalls++;
    signal = init?.signal;
    started.resolve();
    return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal?.reason), { once: true }));
  };
  let settled = false;
  const result = invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl, researchTimeoutMs: 3000 }), input)
    .then((value) => { settled = true; return value; });
  const outcome = result.catch((error: unknown) => error);
  await started.promise;
  try {
    t.mock.timers.tick(2000);
    await flushGraph();
    assert.equal(settled, true);
    assert.equal(signal?.aborted, true);
    assert.equal(fetchCalls, 1, "an aborted request cannot retry");
    assert.equal(calls.length, 2, "only planning and ranking run");
    assert.deepEqual((await result).recommendations, []);
    t.mock.timers.tick(20_000);
    await flushGraph();
    assert.equal(fetchCalls, 1);
  } finally {
    t.mock.timers.tick(20_000);
    await outcome;
  }
});

test("the research cutoff during reflection cancels its search and ranks the evidence already verified", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const reflectionSearch = deferred();
  const requests: string[] = [];
  let reflectionSignal: AbortSignal | null | undefined;
  const { client, calls } = fakeModelClient({
    extract: () => ({ candidates: [{ name: "Fen", hits: [1] }] }),
    reflect: () => ({ sufficient: false, gaps: ["one band only"], extraQueries: ["more blackgaze"] }),
    rank: () => ({ reply: "Try Fen.", recommendations: [{ artist: "Fen", why: "See https://blog.example/fen", sourceSignals: [] }] }),
  });
  const { fetchImpl: answers } = fakeFetch({
    brave: () => ({ web: { results: [{ title: "Fen", url: "https://blog.example/fen", description: "Try Fen" }] } }),
    musicbrainz: () => ({ artists: [{ id: "fen", name: "Fen", score: 100 }] }),
  });
  const fetchImpl: typeof fetch = async (url, init) => {
    const address = String(url);
    requests.push(address);
    if (address.includes("q=more%20blackgaze")) {
      reflectionSignal = init?.signal;
      reflectionSearch.resolve();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    }
    return answers(url, init);
  };
  let settled = false;
  const result = invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl, lastFmApiKey: "lastfm", musicBrainzMinIntervalMs: 0 }), input)
    .then((value) => { settled = true; return value; });
  const outcome = result.catch((error: unknown) => error);
  await reflectionSearch.promise;
  try {
    t.mock.timers.tick(48_000);
    await flushGraph();
    assert.equal(settled, true, "research stops at 48 seconds, preserving the 12-second ranking reserve");
    assert.equal(reflectionSignal?.aborted, true, "the reflection search receives cancellation");
    const value = await result;
    assert.equal(value.pipelineDiagnostics.verifiedCount, 1, "the verified candidate from the initial pass is kept");
    assert.equal(value.recommendations.length, 1);
    assert.equal(calls.filter((call) => call.system.startsWith("You extract")).length, 1, "reflection extraction is skipped");
    assert.match(calls.find((call) => call.system.startsWith("You recommend"))?.user ?? "", /artist: Fen/);
  } finally {
    t.mock.timers.tick(60_000);
    await outcome;
  }
});

test("a verification batch cancelled in the MusicBrainz queue never reaches the transport", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
  const searched = deferred();
  const { client } = fakeModelClient({
    extract: () => ({ candidates: [{ name: "Fen", hits: [1] }] }),
  });
  const { fetchImpl: answers } = fakeFetch({
    brave: () => ({ web: { results: [{ title: "Fen", url: "https://blog.example/fen", description: "Try Fen" }] } }),
    musicbrainz: () => ({ artists: [] }),
  });
  let musicBrainzCalls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    if (String(url).includes("musicbrainz.org")) {
      musicBrainzCalls++;
      searched.resolve();
    }
    return answers(url, init);
  };
  let settled = false;
  const result = invokeResearchGraph(graphDeps({ modelClient: client, fetchImpl, researchTimeoutMs: 900 }), input)
    .then((value) => { settled = true; return value; });
  const outcome = result.catch((error: unknown) => error);
  await searched.promise;
  await flushGraph();
  try {
    t.mock.timers.tick(600);
    await flushGraph();
    assert.equal(settled, true, "the 1100 ms MusicBrainz wait cannot consume the ranking reserve");
    assert.equal(musicBrainzCalls, 1, "only the first batch was sent; the second was queued");
    await result;
    t.mock.timers.tick(5000);
    await flushGraph();
    assert.equal(musicBrainzCalls, 1, "a queued batch must not start after the run completes");
  } finally {
    t.mock.timers.tick(20_000);
    await outcome;
  }
});

for (const provider of ["gemini", "scaleway"] as const) {
  test(`the ${provider} adapter forwards deadline cancellation to its HTTP request`, async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1_000_000 });
    const started = deferred();
    let requestSignal: AbortSignal | null | undefined;
    let requests = 0;
    const transport: typeof fetch = async (_url, init) => {
      requests++;
      requestSignal = init?.signal;
      started.resolve();
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    };
    t.mock.method(globalThis, "fetch", transport);
    const { client: answers } = fakeModelClient();
    const modelFactory = createChatModelFactory(
      { provider, model: "test-model" },
      { geminiApiKey: "test-key", scalewayApiKey: "test-key", scalewayBaseUrl: "", fetchImpl: transport },
    );
    const { fetchImpl } = fakeFetch({});
    const outcome = invokeResearchGraph(graphDeps({
      chatModel: (settings) => rankerVia(modelFactory(settings), answers),
      fetchImpl,
      researchTimeoutMs: 3000,
    }), input).catch((error: unknown) => error);
    await started.promise;
    try {
      t.mock.timers.tick(3000);
      await flushGraph();
      assert.match(String(await outcome), /timeout/);
      assert.equal(requestSignal?.aborted, true, "the provider must forward the graph's abort signal");
      t.mock.timers.tick(60_000);
      await flushGraph();
      assert.equal(requests, 1, "provider cancellation cannot cause a background SDK retry");
    } finally {
      t.mock.timers.tick(60_000);
      await outcome;
    }
  });
}

test("the Gemini adapter assembles a streamed answer before the graph returns recommendations", async (t) => {
  const payload = JSON.stringify({ reply: "Try Fen.", recommendations: [{ artist: "Fen", why: "See https://blog.example/fen", sourceSignals: [] }] });
  const chunks = [payload.slice(0, 30), payload.slice(30)];
  t.mock.method(globalThis, "fetch", async () => new Response(chunks.map((text, index) => `data: ${JSON.stringify({
    candidates: [{ index: 0, content: { role: "model", parts: [{ text }] }, ...(index === 1 ? { finishReason: "STOP" } : {}) }],
  })}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }));
  const modelFactory = createChatModelFactory(
    { provider: "gemini", model: "gemini-2.5-flash" },
    { geminiApiKey: "test-key", scalewayApiKey: "", scalewayBaseUrl: "" },
  );
  const { client } = fakeModelClient({
    extract: () => ({ candidates: [{ name: "Fen", hits: [1] }] }),
  });
  const { fetchImpl } = fakeFetch({
    brave: () => ({ web: { results: [{ title: "Fen", url: "https://blog.example/fen", description: "Try Fen" }] } }),
    musicbrainz: () => ({ artists: [{ id: "fen", name: "Fen", score: 100 }] }),
  });
  const result = await invokeResearchGraph(graphDeps({
    chatModel: (settings) => rankerVia(modelFactory(settings), client),
    fetchImpl,
    musicBrainzMinIntervalMs: 0,
  }), input);
  assert.equal(result.assistantReply, "Try Fen.");
  assert.equal(result.recommendations.length, 1);
  assert.equal((result.recommendations[0] as { artist: string }).artist, "Fen");
});
