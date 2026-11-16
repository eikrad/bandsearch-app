import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import type { ChatModelClient } from "../agent/modelUtils.js";

/** Keep cancellation working on the legacy Gemini research adapter. */
export function createGeminiChatClient(options: {
  apiKey: string;
  model: string;
  temperature: number;
}): ChatModelClient {
  return new ChatGoogleGenerativeAI({
    ...options,
    thinkingConfig: { thinkingBudget: 0 },
    // The pinned SDK drops the signal on its non-streaming path. invoke still
    // returns the assembled message when streaming is enabled internally.
    streaming: true,
    // Its retry loop can also retry an aborted request in the background.
    // JSON repair retries remain inside the graph's cancellable operation.
    maxRetries: 0,
  });
}
