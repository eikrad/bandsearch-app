import test from "node:test";
import assert from "node:assert/strict";

import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { bootstrapDesktopReactShell } from "../src/index.js";
import { createPendingSearchStore, type PendingSearch, type PendingSearchStore } from "../src/pendingSearchStore.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
import { frame, jobNotFound, liveSseResponse, sseResponse } from "./helpers/fakeSearchJobApi.js";

/**
 * A search survives the app being stopped (ADR 0006, #345): what the user sees
 * when they come back to a search that finished, still runs, or was lost, and
 * when the connection drops while they wait. Driven through the real app,
 * model and shell against a fake job API.
 */

const answer = (artist = "Fen") => ({
  type: "done",
  response: { recommendations: [{ artist, why: "Fits", sourceSignals: [] }], assistantReply: `Try ${artist}.`, meta: { turn: "search", eventId: "ev-1" } },
});

function memoryPendingSearch(initial: PendingSearch | null = null): PendingSearchStore & { current(): PendingSearch | null } {
  let stored = initial;
  return {
    get: () => stored,
    set: (search) => { stored = search; },
    clear: () => { stored = null; },
    current: () => stored,
  };
}

type Follow = (jobId: string, attempt: number, signal: AbortSignal | null | undefined, url: string) => Response | Promise<Response>;

function appWithJobServer({
  follow,
  pendingSearch = memoryPendingSearch(),
  sessionMessages = [],
}: {
  follow: Follow;
  pendingSearch?: PendingSearchStore;
  sessionMessages?: Array<{ role: string; content: string }>;
}) {
  const started: Array<Record<string, unknown>> = [];
  const stopped: string[] = [];
  const follows: string[] = [];
  const attempts = new Map<string, number>();
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const address = String(url);
    const method = init.method ?? "GET";
    if (address.endsWith("/sessions") && method === "POST") return jsonResponse({ session: { id: "s-1", title: "Untitled" } });
    if (address.endsWith("/sessions/s-1") && method === "GET") {
      return jsonResponse({ session: { id: "s-1", title: "t" }, messages: sessionMessages.map((m, i) => ({ id: `m${i}`, ...m, createdAt: "" })) });
    }
    if (address.endsWith("/recommendations/jobs") && method === "POST") {
      started.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return jsonResponse({ jobId: `job-${started.length}` }, { status: 202 });
    }
    const job = /\/recommendations\/jobs\/([^/?]+)/.exec(address)?.[1];
    if (job && method === "DELETE") {
      stopped.push(job);
      return new Response(null, { status: 204 });
    }
    if (job) {
      follows.push(address);
      const attempt = attempts.get(job) ?? 0;
      attempts.set(job, attempt + 1);
      return follow(job, attempt, init.signal, address);
    }
    return jsonResponse({});
  }) as unknown as typeof fetch;

  const app = bootstrapDesktopApp({ apiBaseUrl: "http://api.test", fetchImpl, pendingSearch, sleep: async () => {} });
  const shell = bootstrapDesktopReactShell({ app });
  return { app, shell, started, stopped, follows };
}

const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
const chatOf = (shell: ReturnType<typeof bootstrapDesktopReactShell>) =>
  (shell.getViewProps().messages ?? []).map((m) => `${m.role}: ${m.content}`);

test("while a search runs, its job is kept on the device; once the answer is shown it is forgotten", async () => {
  const pendingSearch = memoryPendingSearch();
  let live!: ReturnType<typeof liveSseResponse>;
  const { shell } = appWithJobServer({ pendingSearch, follow: (_job, _n, signal) => (live = liveSseResponse(signal)).response });
  await shell.updateObscurityTarget("obscure");

  const searching = shell.submitQuery("slowcore like Codeine");
  await settle();
  assert.deepEqual(pendingSearch.current(), { jobId: "job-1", query: "slowcore like Codeine", mode: "fresh", obscurityTarget: "obscure" });

  live.send(answer(), 1);
  await searching;
  assert.equal(pendingSearch.current(), null);
  assert.deepEqual(chatOf(shell), ["user: slowcore like Codeine", "assistant: Try Fen."]);
});

test("back in the app, a search that finished meanwhile is shown as the answer to its question", async () => {
  const pendingSearch = memoryPendingSearch({ jobId: "job-7", query: "slowcore like Codeine", mode: "fresh" });
  const { app, shell, started } = appWithJobServer({
    pendingSearch,
    // The question was saved to the chat before the app was stopped; the answer was not.
    sessionMessages: [{ role: "user", content: "slowcore like Codeine" }],
    follow: (job) => job === "job-7" ? sseResponse([frame({ type: "progress", progress: { stage: "thinking" } }, 1), frame(answer("Duster"), 2)]) : jobNotFound(),
  });
  await app.resumeSession("s-1");

  await shell.resumeSearch();

  assert.deepEqual(chatOf(shell), ["user: slowcore like Codeine", "assistant: Try Duster."], "the question once, then its answer");
  assert.equal(shell.getViewProps().cards[0]?.title, "Duster");
  assert.equal(shell.getViewProps().showFeedbackBar, true, "the batch can be judged like any other");
  assert.equal(started.length, 0, "nothing is asked again");
  assert.equal(pendingSearch.current(), null);
});

test("back in the app, a search still running is followed again with its progress on screen", async () => {
  let live!: ReturnType<typeof liveSseResponse>;
  const { shell } = appWithJobServer({
    pendingSearch: memoryPendingSearch({ jobId: "job-7", query: "slowcore", mode: "fresh" }),
    follow: (_job, _n, signal) => (live = liveSseResponse(signal)).response,
  });

  const resuming = shell.resumeSearch();
  await settle();
  live.send({ type: "progress", progress: { stage: "checking", found: 7 } }, 3);
  await settle();
  assert.equal(shell.getViewProps().isLoading, true);
  assert.equal(shell.getViewProps().progressLabel, "Found 7 bands, checking them…");
  assert.deepEqual(chatOf(shell), ["user: slowcore"]);

  live.send(answer(), 4);
  await resuming;
  assert.deepEqual(chatOf(shell), ["user: slowcore", "assistant: Try Fen."]);
});

test("a search the server lost says so, offers Retry, and Retry asks the question again", async () => {
  const pendingSearch = memoryPendingSearch({ jobId: "job-7", query: "slowcore", mode: "fresh" });
  const { shell, started } = appWithJobServer({
    pendingSearch,
    follow: (job) => job === "job-7" ? jobNotFound() : sseResponse([frame(answer(), 1)]),
  });

  await assert.rejects(shell.resumeSearch());
  const status = shell.getViewProps().actionStatus;
  assert.equal(status?.type, "error");
  assert.match(status?.message ?? "", /lost/i);
  assert.equal(shell.getViewProps().searchFailed, true, "Retry stays in view");
  assert.equal(pendingSearch.current(), null, "it is not reported again on the next launch");
  assert.deepEqual(chatOf(shell), ["user: slowcore"]);

  await shell.retryLastSearch();
  assert.equal(started[0]?.query, "slowcore");
  assert.deepEqual(chatOf(shell), ["user: slowcore", "assistant: Try Fen."]);
  assert.equal(shell.getViewProps().searchFailed, false);
});

test("Stop ends the search on the server too, forgets it, and shows no error", async () => {
  const pendingSearch = memoryPendingSearch();
  const { shell, stopped } = appWithJobServer({ pendingSearch, follow: (_job, _n, signal) => liveSseResponse(signal).response });

  const searching = shell.submitQuery("slowcore");
  await settle();
  shell.cancelSearch();
  await searching;

  assert.deepEqual(stopped, ["job-1"]);
  assert.equal(pendingSearch.current(), null);
  assert.equal(shell.getViewProps().actionStatus, null);
  assert.equal(shell.getViewProps().isLoading, false);
});

test("a connection that drops while waiting is not an error: the app attaches again and shows the answer", async () => {
  const { shell, follows } = appWithJobServer({
    follow: (_job, attempt) => attempt === 0
      ? sseResponse([frame({ type: "progress", progress: { stage: "thinking" } }, 1)])
      : sseResponse([frame(answer(), 2)]),
  });

  await shell.submitQuery("slowcore");

  assert.equal(follows.length, 2);
  assert.equal(shell.getViewProps().actionStatus, null);
  assert.deepEqual(chatOf(shell), ["user: slowcore", "assistant: Try Fen."]);
});

test("when the connection does not come back, the app says so and keeps the search to pick up later", async () => {
  const pendingSearch = memoryPendingSearch();
  let online = false;
  const { shell, started } = appWithJobServer({
    pendingSearch,
    follow: () => {
      if (!online) throw new TypeError("network down");
      return sseResponse([frame(answer(), 1)]);
    },
  });

  await assert.rejects(shell.submitQuery("slowcore"));
  assert.match(shell.getViewProps().actionStatus?.message ?? "", /connection/i);
  assert.equal(pendingSearch.current()?.jobId, "job-1", "kept: the search runs on");

  online = true;
  await shell.resumeSearch();
  assert.deepEqual(chatOf(shell), ["user: slowcore", "assistant: Try Fen."]);
  assert.equal(started.length, 1);
  assert.equal(pendingSearch.current(), null);
});

test("coming back while a search is followed attaches to it again rather than starting another", async () => {
  let live!: ReturnType<typeof liveSseResponse>;
  const { shell, started, follows } = appWithJobServer({
    follow: (_job, attempt, signal) => {
      live = liveSseResponse(signal);
      if (attempt === 0) live.send({ type: "progress", progress: { stage: "thinking" } }, 1);
      return live.response;
    },
  });

  const searching = shell.submitQuery("slowcore");
  await settle();
  await shell.resumeSearch();
  await settle();
  live.send(answer(), 2);
  await searching;

  assert.equal(started.length, 1);
  assert.equal(follows.length, 2);
  assert.match(follows[1]!, /\?after=1$/);
  assert.deepEqual(chatOf(shell), ["user: slowcore", "assistant: Try Fen."]);
});

test("a search stopped by a newer one elsewhere says so rather than vanishing", async () => {
  const { shell } = appWithJobServer({ follow: () => sseResponse([frame({ type: "cancelled" }, 1)]) });
  await assert.rejects(shell.submitQuery("slowcore"));
  assert.match(shell.getViewProps().actionStatus?.message ?? "", /stopped/i);
});

test("with no stored search, coming back does nothing", async () => {
  const { shell, follows } = appWithJobServer({ follow: () => jobNotFound() });
  await shell.resumeSearch();
  assert.equal(follows.length, 0);
  assert.equal(shell.getViewProps().actionStatus, null);
});

test("a device that refuses local storage still searches", async () => {
  const refusing = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => { throw new Error("denied"); },
  };
  const { shell } = appWithJobServer({
    pendingSearch: createPendingSearchStore(() => refusing),
    follow: () => sseResponse([frame(answer(), 1)]),
  });
  await shell.submitQuery("slowcore");
  await shell.resumeSearch();
  assert.deepEqual(chatOf(shell), ["user: slowcore", "assistant: Try Fen."]);
});

test("a stored search that is not one is ignored", () => {
  const values: Record<string, string> = { bandsearch_pending_search: "{\"jobId\":42}" };
  const store = createPendingSearchStore(() => ({
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => { values[key] = value; },
    removeItem: (key) => { delete values[key]; },
  }));
  assert.equal(store.get(), null);
  store.set({ jobId: "job-1", query: "slowcore", mode: "fresh" });
  assert.deepEqual(store.get(), { jobId: "job-1", query: "slowcore", mode: "fresh" });
  store.clear();
  assert.equal(store.get(), null);
});
