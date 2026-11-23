import test from "node:test";
import assert from "node:assert/strict";
import { BandsearchHttpError } from "../src/chatClient.js";
import { formatRecommendationQueryError } from "../src/apiErrorMessages.js";

test("formatRecommendationQueryError maps rate_limit_exceeded", () => {
  const msg = formatRecommendationQueryError(
    new BandsearchHttpError("too many", { status: 429, code: "rate_limit_exceeded" }),
  );
  assert.match(msg, /too many|wait/i);
});

test("formatRecommendationQueryError maps recommendation_initializing", () => {
  const msg = formatRecommendationQueryError(
    new BandsearchHttpError("init", { status: 503, code: "recommendation_initializing" }),
  );
  assert.match(msg, /starting|seconds/i);
});

test("formatRecommendationQueryError maps recommendation_context_unavailable", () => {
  const msg = formatRecommendationQueryError(
    new BandsearchHttpError("ctx", { status: 502, code: "recommendation_context_unavailable" }),
  );
  assert.match(msg, /network|Music|lookup/i);
});

test("formatRecommendationQueryError maps recommendation_unavailable to LLM key guidance", () => {
  const msg = formatRecommendationQueryError(
    new BandsearchHttpError("recommendation service unavailable", {
      status: 502,
      code: "recommendation_unavailable",
    }),
  );
  assert.match(msg, /Scaleway API key/);
  assert.doesNotMatch(msg, /Gemini/);
});

test("formatRecommendationQueryError passes through validation_error message", () => {
  const msg = formatRecommendationQueryError(
    new BandsearchHttpError("query is required", { status: 400, code: "validation_error" }),
  );
  assert.equal(msg, "query is required");
});

test("formatRecommendationQueryError maps TypeError to connectivity hint", () => {
  const msg = formatRecommendationQueryError(new TypeError("fetch failed"));
  assert.match(msg, /reach|API|network/i);
});

test("formatRecommendationQueryError maps unknown errors to generic API hint", () => {
  const msg = formatRecommendationQueryError(new Error("something else"));
  assert.match(msg, /reach|API|running/i);
});

test("the ends of a search that are not an answer read as UI_GUIDELINES words them", () => {
  const say = (code: string) => formatRecommendationQueryError(new BandsearchHttpError("x", { code }));
  assert.equal(say("search_lost"), "This search was lost: the server restarted or kept it too long. Retry to ask again.");
  assert.equal(say("search_cancelled"), "This search was stopped, perhaps by a newer search on another device. Retry to ask again.");
  assert.equal(
    say("search_disconnected"),
    "The connection to the server dropped. Your search keeps running there; Bandsearch picks it up when you come back to the app.",
  );
});
