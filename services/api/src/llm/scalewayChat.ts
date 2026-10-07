import { ChatOpenAI } from "@langchain/openai";

import type { ChatModelClient } from "../agent/modelUtils.js";

/**
 * Scaleway Generative APIs: OpenAI-compatible Chat Completions, hosted in the
 * EU. A project-scoped endpoint (`https://api.scaleway.ai/<project>/v1`) can
 * replace this through `SCW_BASE_URL`.
 */
export const SCALEWAY_DEFAULT_BASE_URL = "https://api.scaleway.ai/v1";

export type ScalewayChatOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  /** Ask the API for a JSON object (`response_format`), for callers that parse JSON. */
  json?: boolean;
  /**
   * Scaleway turns reasoning on by default for every model that has it, which
   * made one extraction take 101 s on gemma. "none" turns it off (all models
   * except gpt-oss-120b, which needs "low" or higher); values differ by model.
   */
  reasoningEffort?: string;
  /**
   * Retries after a failed call. Kept low on purpose: callers wrap each call in
   * a per-node time budget, and LangChain's default of several retries with
   * backoff can outlast that budget on its own.
   */
  maxRetries?: number;
  /** Per-request timeout in ms, enforced by the OpenAI client. */
  timeoutMs?: number;
  /** Transport; tests pass a fake so no call leaves the process. */
  fetchImpl?: typeof fetch;
};

/**
 * A chat model on Scaleway, behind the same `ChatModelClient` surface every
 * agent node and the judge use. Built on LangChain's ChatOpenAI so LangSmith
 * tracing keeps working when the provider changes.
 */
export function createScalewayChatClient({
  apiKey,
  model,
  baseUrl = SCALEWAY_DEFAULT_BASE_URL,
  temperature,
  json = false,
  reasoningEffort = "none",
  maxRetries = 1,
  timeoutMs,
  fetchImpl,
}: ScalewayChatOptions): ChatModelClient {
  const key = apiKey.trim();
  if (!key) throw new Error("SCW_SECRET_KEY is required for a Scaleway chat model");

  return new ChatOpenAI({
    model,
    apiKey: key,
    ...(temperature !== undefined ? { temperature } : {}),
    maxRetries,
    ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
    // Scaleway speaks Chat Completions, not OpenAI's Responses API.
    useResponsesApi: false,
    modelKwargs: {
      reasoning_effort: reasoningEffort,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    },
    configuration: {
      baseURL: baseUrl.replace(/\/+$/, ""),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    },
  });
}
