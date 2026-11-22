/**
 * The slice of a LangChain chat model the agent modules actually use.
 *
 * Every `create*` factory here builds a `ChatGoogleGenerativeAI` and then only
 * ever calls `invoke`. Naming that surface lets a caller pass its own client —
 * the same injection the HTTP clients already offer through `fetchImpl` — so
 * the closures these factories return can be exercised without a Gemini key or
 * a network call.
 */
export type ChatModelClient = {
  invoke(prompt: Array<{ role: string; content: string }>, options?: { signal?: AbortSignal }): Promise<{ content: unknown }>;
  /** The answer in pieces; optional, so a fake model need not stream. */
  stream?(
    prompt: Array<{ role: string; content: string }>,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<{ content: unknown }>>;
};

/**
 * A model's answer without its thinking. Reasoning models (qwen3, deepseek, glm
 * on Scaleway) may put that in a <think> block first; braces in there are not
 * the answer. A known Scaleway bug can drop the opening tag, so the answer is
 * whatever follows the last closing tag.
 */
export function withoutThinking(raw: string): string {
  const closing = raw.toLowerCase().lastIndexOf("</think>");
  return (closing === -1 ? raw : raw.slice(closing + "</think>".length))
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
}

/**
 * Extract one balanced JSON object or array from text that may include model preamble or trailing prose.
 */
export function parseModelJsonResponse(raw: string): unknown {
  const text = withoutThinking(raw)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const objStart = text.indexOf("{");
    const arrStart = text.indexOf("[");
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
      const slice = extractBalancedSegment(text, objStart, "{", "}");
      if (slice) {
        try {
          return JSON.parse(slice) as unknown;
        } catch {
          /* try array path */
        }
      }
    }
    if (arrStart !== -1) {
      const slice = extractBalancedSegment(text, arrStart, "[", "]");
      if (slice) {
        return JSON.parse(slice) as unknown;
      }
    }
    throw new Error("invalid recommendation output");
  }
}

function extractBalancedSegment(s: string, startIdx: number, open: string, close: string): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  const quote = '"';
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === quote) {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return s.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage = "recommendation model timeout"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

/**
 * One model call within a research run: never starts once the run is cancelled,
 * forwards cancellation to the provider and rejects with `timeoutMessage` at `timeoutMs`.
 */
export async function invokeModel(
  client: ChatModelClient,
  prompt: Array<{ role: string; content: string }>,
  { signal, timeoutMs, timeoutMessage, onText }: {
    signal?: AbortSignal;
    timeoutMs: number;
    timeoutMessage: string;
    /** Told the raw answer so far as it arrives, when the client can stream. */
    onText?: (soFar: string) => void;
  },
): Promise<{ content: unknown }> {
  signal?.throwIfAborted();
  if (!onText || !client.stream) return withTimeout(client.invoke(prompt, { signal }), timeoutMs, timeoutMessage);

  const controller = new AbortController();
  const read = async () => {
    let text = "";
    const pieces = await client.stream!(prompt, { signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
    for await (const piece of pieces) {
      // A timed-out answer must not keep talking.
      controller.signal.throwIfAborted();
      if (typeof piece.content !== "string" || !piece.content) continue;
      text += piece.content;
      onText(text);
    }
    return { content: text };
  };
  try {
    return await withTimeout(read(), timeoutMs, timeoutMessage);
  } finally {
    controller.abort();
  }
}

/**
 * The reply a ranker is writing, from its unfinished JSON answer; "" before it
 * starts. The reply is the first field of that answer, so it can be shown while
 * the recommendations are still being written.
 */
export function replySoFar(unfinishedJson: string): string {
  const start = /"reply"\s*:\s*"/.exec(unfinishedJson);
  if (!start) return "";
  const rest = unfinishedJson.slice(start.index + start[0].length);
  const closing = /(?<!\\)(?:\\\\)*"/.exec(rest);
  // Without its closing quote the string may end inside an escape (\\, \\u00e), which is left out.
  const written = closing
    ? rest.slice(0, closing.index + closing[0].length - 1)
    : rest.replace(/(?<!\\)((?:\\\\)*)\\(?:u[0-9a-fA-F]{0,3})?$/, "$1");
  try {
    return String(JSON.parse(`"${written.replace(/[\n\r\t]/g, " ")}"`)).trimStart();
  } catch {
    return "";
  }
}

/** A thrown value as loggable text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
