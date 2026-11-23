import type { ChatModelClient } from "../agent/modelUtils.js";
import type { LlmConfig, ModelRef } from "../config/models.js";
import { createScalewayChatClient, SCALEWAY_DEFAULT_BASE_URL } from "./scalewayChat.js";

/**
 * Builds the chat model for one call site. Each research node asks for its own
 * temperature, so the graph only needs to know the configured model, not how
 * each node tunes it.
 */
export type ChatModelFactory = (settings: { temperature: number; json?: boolean }) => ChatModelClient;

export type ChatModelKeys = Pick<LlmConfig, "scalewayApiKey" | "scalewayBaseUrl"> & {
  /** Transport for Scaleway calls; tests pass a fake. */
  fetchImpl?: typeof fetch;
};

export function createChatModelFactory(ref: ModelRef, keys: ChatModelKeys): ChatModelFactory {
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

/** Where a research node gets its model: a ready client (tests) or the configured factory. */
export type NodeModelSource = {
  modelClient?: ChatModelClient;
  chatModel?: ChatModelFactory;
};

/**
 * The model a research node runs on. There is no default provider to fall back
 * on (#303), so a node given neither fails here, when it is built, rather than
 * later at some network client.
 */
export function nodeModel(node: string, { modelClient, chatModel }: NodeModelSource, settings: { temperature: number }): ChatModelClient {
  const client = modelClient ?? chatModel?.(settings);
  if (!client) throw new Error(`${node} needs a chat model (chatModel or modelClient)`);
  return client;
}
