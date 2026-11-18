import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapDesktopApp } from "../src/bootstrapDesktopApp.js";
import { bootstrapDesktopReactApp } from "../src/index.js";
import { jsonResponse } from "./helpers/fakeResponse.js";
import { fakeContainer, fakeReactRoot } from "./helpers/fakeDom.js";

/**
 * The feedback bar under a recommendation batch, driven through the real app,
 * shell and mount against a fake API server. ADR 0006: a click reaches the
 * API with the batch it judges; it is never silently dropped.
 */

type ViewProps = {
  showFeedbackBar?: boolean;
  actionStatus?: { type: string; message: string } | null;
};

function chatWithFakeServer({ feedbackStatus = 200 }: { feedbackStatus?: number } = {}) {
  const feedbackRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const address = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (address.endsWith("/sessions") && init.method === "POST") {
      return jsonResponse({ session: { id: "s-1", title: "Untitled" } });
    }
    if (address.endsWith("/feedback")) {
      feedbackRequests.push({ url: address, body });
      return feedbackStatus === 200
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: { code: "internal_error", message: "unexpected server error" } }, { status: feedbackStatus });
    }
    if (address.endsWith("/recommendations")) {
      return jsonResponse({
        recommendations: [
          { artist: "Bedhead", why: "Fits", sourceSignals: [] },
          { artist: "Duster", why: "Fits", sourceSignals: [] },
        ],
        meta: { modeUsed: "fresh", usedPreferenceContext: false, eventId: "ev-1" },
      });
    }
    return jsonResponse({});
  }) as unknown as typeof fetch;

  const app = bootstrapDesktopApp({ apiBaseUrl: "http://api.test", fetchImpl });
  const ui = bootstrapDesktopReactApp({
    app,
    createRootImpl: () => fakeReactRoot(),
    resolveContainer: () => fakeContainer({ id: "root" }),
  });
  // mount() repaints and returns what the chat view was given.
  const viewProps = async () => (await ui.mount()) as ViewProps;
  return { handlers: ui.handlers, feedbackRequests, viewProps };
}

test("a feedback click sends the batch it judges to that batch's feedback route and closes the bar", async () => {
  const { handlers, feedbackRequests, viewProps } = chatWithFakeServer();
  await handlers.onQuerySubmit("slowcore like Codeine");
  assert.equal((await viewProps()).showFeedbackBar, true, "the bar is offered under the batch");

  // The verdict is about the batch as it was asked, not the controls' state now.
  await handlers.onModeChange("preference-aware");
  await handlers.onFeedback?.("too_mainstream");

  assert.deepEqual(feedbackRequests, [{
    url: "http://api.test/recommendations/ev-1/feedback",
    body: {
      feedbackType: "too_mainstream",
      query: "slowcore like Codeine",
      mode: "fresh",
      obscurityTarget: "underground",
      bandNames: ["Bedhead", "Duster"],
    },
  }]);
  assert.equal((await viewProps()).showFeedbackBar, false, "the bar closes after a click");
});

test("dismissing the feedback bar closes it and sends nothing", async () => {
  const { handlers, feedbackRequests, viewProps } = chatWithFakeServer();
  await handlers.onQuerySubmit("slowcore like Codeine");
  await handlers.onFeedbackDismiss?.();
  assert.equal((await viewProps()).showFeedbackBar, false);
  assert.deepEqual(feedbackRequests, []);
});

test("feedback the API refuses is reported inline instead of being dropped", async () => {
  const { handlers, viewProps } = chatWithFakeServer({ feedbackStatus: 500 });
  await handlers.onQuerySubmit("slowcore like Codeine");
  await handlers.onFeedback?.("good");
  assert.deepEqual((await viewProps()).actionStatus, { type: "error", message: "Your feedback could not be sent." });
  assert.equal((await viewProps()).showFeedbackBar, false);
});
