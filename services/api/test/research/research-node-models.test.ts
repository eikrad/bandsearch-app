import test from "node:test";
import assert from "node:assert/strict";

import { createWebSearchPlanner } from "../../src/agent/research/webSearchPlanner.js";
import { createCandidateExtractor } from "../../src/agent/research/candidateExtractor.js";
import { createRecommendationReflector } from "../../src/agent/research/recommendationReflector.js";
import { createRecommendationRanker } from "../../src/agent/research/recommendationRanker.js";

/**
 * A research node used to build a Gemini client when it was given no model.
 * With Gemini gone (#303) there is no default to fall back on: a node built
 * without a model must fail at once, not reach some network client later.
 */
const NODES: Array<[string, () => Promise<unknown>]> = [
  ["web search planner", () => createWebSearchPlanner({})],
  ["candidate extractor", () => createCandidateExtractor({})],
  ["recommendation reflector", () => createRecommendationReflector({})],
  ["recommendation ranker", () => createRecommendationRanker({})],
];

for (const [node, build] of NODES) {
  test(`the ${node} refuses to be built without a chat model`, async () => {
    await assert.rejects(build, new RegExp(`${node} needs a chat model`));
  });
}
