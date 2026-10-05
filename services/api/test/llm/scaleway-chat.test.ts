import test from "node:test";
import assert from "node:assert/strict";

import { createScalewayChatClient, SCALEWAY_DEFAULT_BASE_URL } from "../../src/llm/scalewayChat.js";

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

/** An OpenAI-shaped Chat Completions endpoint that records what it was sent. */
function fakeScaleway(reply = "{\"ok\":true}", status = 200): { fetchImpl: typeof fetch; requests: Captured[] } {
  const requests: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({ url: request.url, headers: request.headers, body: (await request.json()) as Record<string, unknown> });
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { message: "upstream failed" } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const prompt = [
  { role: "system", content: "You plan searches." },
  { role: "user", content: "bands like Alcest" },
];

test("a Scaleway chat model sends the prompt to Scaleway's chat completions endpoint", async () => {
  const { fetchImpl, requests } = fakeScaleway("plan");
  const client = createScalewayChatClient({ apiKey: "scw-secret", model: "gemma-4-26b-a4b-it", fetchImpl });

  const response = await client.invoke(prompt);

  assert.equal(response.content, "plan");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, `${SCALEWAY_DEFAULT_BASE_URL}/chat/completions`);
  assert.equal(requests[0]!.headers.get("authorization"), "Bearer scw-secret");
  assert.equal(requests[0]!.body.model, "gemma-4-26b-a4b-it");
  assert.deepEqual(
    (requests[0]!.body.messages as Array<{ role: string; content: string }>).map((m) => [m.role, m.content]),
    [
      ["system", "You plan searches."],
      ["user", "bands like Alcest"],
    ],
  );
});

test("a project-scoped base URL replaces the default endpoint", async () => {
  const { fetchImpl, requests } = fakeScaleway();
  const client = createScalewayChatClient({
    apiKey: "k",
    model: "m",
    baseUrl: "https://api.scaleway.ai/1234-project/v1/",
    fetchImpl,
  });

  await client.invoke(prompt);

  assert.equal(requests[0]!.url, "https://api.scaleway.ai/1234-project/v1/chat/completions");
});

test("a Scaleway chat model in JSON mode asks the API for a JSON object", async () => {
  const { fetchImpl, requests } = fakeScaleway();
  const client = createScalewayChatClient({ apiKey: "k", model: "m", json: true, temperature: 0, fetchImpl });

  await client.invoke(prompt);

  assert.deepEqual(requests[0]!.body.response_format, { type: "json_object" });
  assert.equal(requests[0]!.body.temperature, 0);
});

test("a failing call is retried at most as often as configured, so node budgets hold", async () => {
  const { fetchImpl, requests } = fakeScaleway("", 500);
  const client = createScalewayChatClient({ apiKey: "k", model: "m", maxRetries: 1, fetchImpl });

  await assert.rejects(client.invoke(prompt));

  assert.equal(requests.length, 2, "one call plus one retry");
});

test("a Scaleway chat model needs a key", () => {
  assert.throws(() => createScalewayChatClient({ apiKey: "  ", model: "m" }), /SCW_SECRET_KEY/);
});

test("reasoning is off unless asked for, so pipeline calls stay fast", async () => {
  // Scaleway enables reasoning by default on every model that has it; one
  // extraction took gemma 101 s with it on.
  const { fetchImpl, requests } = fakeScaleway();
  await createScalewayChatClient({ apiKey: "k", model: "m", fetchImpl }).invoke(prompt);
  assert.equal(requests[0]!.body.reasoning_effort, "none");
});

test("a reasoning effort can be asked for, e.g. for a model that cannot turn it off", async () => {
  const { fetchImpl, requests } = fakeScaleway();
  await createScalewayChatClient({ apiKey: "k", model: "gpt-oss-120b", reasoningEffort: "low", fetchImpl }).invoke(prompt);
  assert.equal(requests[0]!.body.reasoning_effort, "low");
});
