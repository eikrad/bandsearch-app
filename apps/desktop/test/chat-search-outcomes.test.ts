import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { bootstrapDesktopReactShell } from "../src/index.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
import { withSearchJobs } from "./helpers/fakeSearchJobApi.js";

/**
 * What the user sees after Search, Retry and Stop, driven through the real app,
 * render adapter and shell against a fake API server (UI_GUIDELINES.md,
 * "Chat and request states": inline recoverable errors with retry).
 */

type RecommendationReply = "fail" | "hang" | { artist: string };

function chatWithFakeServer(replies: RecommendationReply[]) {
  const requestBodies: Array<{ query: string; messages?: Array<{ role: string; content: string }> }> = [];
  const persisted: Array<{ role: string; content: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const address = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (address.endsWith("/sessions") && init.method === "POST") {
      return jsonResponse({ session: { id: "s-1", title: "Untitled" } });
    }
    if (address.endsWith("/sessions/s-1/messages")) {
      persisted.push(body);
      return jsonResponse({});
    }
    if (address.endsWith("/recommendations")) {
      requestBodies.push(body);
      const reply = replies.shift() ?? "fail";
      if (reply === "fail") {
        return jsonResponse(
          { error: { code: "recommendation_unavailable", message: "recommendation service unavailable" } },
          { status: 502 },
        );
      }
      if (reply === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      }
      return jsonResponse({ recommendations: [{ artist: reply.artist, why: "Fits", sourceSignals: [] }], meta: {} });
    }
    return jsonResponse({});
  }) as unknown as typeof fetch;

  const app = bootstrapDesktopApp({ apiBaseUrl: "http://api.test", fetchImpl: withSearchJobs(fetchImpl) });
  const shell = bootstrapDesktopReactShell({ app });
  return { app, shell, requestBodies, persisted };
}

function userQuestions(shell: ReturnType<typeof chatWithFakeServer>["shell"]) {
  return (shell.getViewProps().messages ?? []).filter((m) => m.role === "user").map((m) => m.content);
}

test("a failed retry shows the same inline error as a failed search", async () => {
  const failedSearch = chatWithFakeServer(["fail"]);
  await assert.rejects(() => failedSearch.shell.submitQuery("drone metal"));
  const searchError = failedSearch.shell.getViewProps().actionStatus;
  assert.equal(searchError?.type, "error");

  const failedRetry = chatWithFakeServer([{ artist: "Fen" }, "fail"]);
  await failedRetry.shell.submitQuery("drone metal");
  assert.equal(failedRetry.shell.getViewProps().actionStatus, null);
  await assert.rejects(() => failedRetry.shell.retryLastSearch());

  assert.deepEqual(failedRetry.shell.getViewProps().actionStatus, searchError);
});

test("stopping a retry shows no error", async () => {
  const { shell } = chatWithFakeServer([{ artist: "Fen" }, "hang"]);
  await shell.submitQuery("drone metal");

  const retry = shell.retryLastSearch();
  await new Promise((resolve) => setTimeout(resolve, 0));
  shell.cancelSearch();
  await retry;

  assert.equal(shell.getViewProps().actionStatus, null);
  assert.equal(shell.getViewProps().isLoading, false);
});

test("retrying a failed question re-runs it without repeating it", async () => {
  const { shell, requestBodies, persisted } = chatWithFakeServer(["fail", { artist: "Fen" }]);
  await assert.rejects(() => shell.submitQuery("drone metal"));
  assert.deepEqual(userQuestions(shell), ["drone metal"], "the failed question stays visible");

  await shell.retryLastSearch();

  assert.deepEqual(userQuestions(shell), ["drone metal"], "Retry does not add a second bubble");
  const messages = shell.getViewProps().messages ?? [];
  assert.equal(messages.at(-1)?.role, "assistant");
  assert.equal(shell.getViewProps().cards[0]?.title, "Fen");
  assert.deepEqual(requestBodies[1].messages ?? [], [], "the retried question is not also sent as history");
  assert.deepEqual(
    persisted.filter((m) => m.role === "user").map((m) => m.content),
    ["drone metal"],
    "the saved chat session records the question once",
  );
});
