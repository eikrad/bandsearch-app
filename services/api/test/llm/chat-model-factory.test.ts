import test from "node:test";
import assert from "node:assert/strict";

import { createChatModelFactory } from "../../src/llm/chatModel.js";

test("a Scaleway research model sends each node's temperature to Scaleway", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    bodies.push((await request.json()) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "gemma-4-26b-a4b-it",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "{}" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const chatModel = createChatModelFactory(
    { provider: "scaleway", model: "gemma-4-26b-a4b-it" },
    { geminiApiKey: "", scalewayApiKey: "scw", scalewayBaseUrl: "", fetchImpl },
  );
  await chatModel({ temperature: 0.35 }).invoke([{ role: "user", content: "rank" }]);

  assert.equal(bodies[0]!.model, "gemma-4-26b-a4b-it");
  assert.equal(bodies[0]!.temperature, 0.35);
});

test("a Gemini research model needs a Gemini key", () => {
  assert.throws(
    () =>
      createChatModelFactory(
        { provider: "gemini", model: "gemini-2.5-flash" },
        { geminiApiKey: "", scalewayApiKey: "", scalewayBaseUrl: "" },
      ),
    /GEMINI_API_KEY/,
  );
});
