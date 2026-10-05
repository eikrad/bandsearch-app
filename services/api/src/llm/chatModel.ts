import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import type { ChatModelClient } from "../agent/modelUtils.js";
import type { LlmConfig, ModelRef } from "../config/models.js";
import { createScalewayChatClient, SCALEWAY_DEFAULT_BASE_URL } from "./scalewayChat.js";

/**
 * Builds the chat model for one call site. Each research node asks for its own
 * temperature, so the graph only needs to know the configured model, not how
 * each node tunes it.
 */
export type ChatModelFactory = (settings: { temperature: number; json?: boolean }) => ChatModelClient;

export type ChatModelKeys = Pick<LlmConfig, "geminiApiKey" | "scalewayApiKey" | "scalewayBaseUrl"> & {
  /** Transport for Scaleway calls; tests pass a fake. */
  fetchImpl?: typeof fetch;
};

export function createChatModelFactory(ref: ModelRef, keys: ChatModelKeys): ChatModelFactory {
  if (ref.provider === "gemini") {
    const apiKey = keys.geminiApiKey.trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY is required for a Gemini model");
    return ({ temperature }) =>
      new ChatGoogleGenerativeAI({
        model: ref.model,
        apiKey,
        temperature,
        thinkingConfig: { thinkingBudget: 0 },
      });
  }

  return ({ temperature, json }) =>
    createScalewayChatClient({
      apiKey: keys.scalewayApiKey,
      model: ref.model,
      baseUrl: keys.scalewayBaseUrl || SCALEWAY_DEFAULT_BASE_URL,
      temperature,
      json,
      reasoningEffort: ref.reasoningEffort,
      fetchImpl: keys.fetchImpl,
    });
}
