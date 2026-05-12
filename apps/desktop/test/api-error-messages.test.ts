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

test("formatRecommendationQueryError maps recommendation_unavailable to Gemini guidance", () => {
  const msg = formatRecommendationQueryError(
    new BandsearchHttpError("recommendation service unavailable", {
      status: 502,
      code: "recommendation_unavailable",
    }),
  );
  assert.match(msg, /Gemini|API key|Settings/i);
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
