import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

import { validateRecommendationItem } from "../../../../shared/schemas/src/contracts.js";

export type RunModelInput = {
  query: string;
  artists: Array<{ name: string; score?: number }>;
  preferenceContext?: string;
  messages: Array<{ role: string; content: string }>;
};

export type RunModel = (input: RunModelInput) => Promise<unknown>;

function isValidRecommendation(item: unknown) {
  return validateRecommendationItem(item).ok;
}

function validateRecommendationOutput(output: unknown[]): unknown[] {
  if (!Array.isArray(output) || output.some((item) => !isValidRecommendation(item))) {
    throw new Error("invalid recommendation output");
  }
  return output;
}

function pickReplyFromParsed(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const p = parsed as Record<string, unknown>;
  const candidates = [p.reply, p.assistant_reply, p.message, p.summary, p.narrative];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/**
 * When the model omits prose (common when it returns a bare JSON array), still give the UI a short dialogue turn.
 */
function buildFallbackAssistantReply(query: string, recommendations: unknown[]): string {
  const names = recommendations
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>).artist : null))
    .filter((n): n is string => typeof n === "string" && Boolean(n.trim()));
  const q = typeof query === "string" ? query.trim() : "";
  const shortQuery = q.length > 160 ? `${q.slice(0, 157)}...` : q;
  const head = shortQuery
    ? `Here are some niche picks that fit what you described (${shortQuery})`
    : "Here are some niche picks to explore";
  const tail = names.length
    ? `: ${names.slice(0, 3).join(", ")}. Want to go heavier or softer, narrow by era, or dig into a regional scene next?`
    : ". Want to go heavier or softer, or narrow the style next?";
  return `${head}${tail}`;
}

/**
 * Accepts legacy JSON array output or structured { reply, recommendations }.
 */
function normalizeModelPayload(parsed: unknown): { assistantReply: string; recommendations: unknown[] } {
  if (Array.isArray(parsed)) {
    return { assistantReply: "", recommendations: validateRecommendationOutput(parsed) };
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).recommendations)) {
    const assistantReply = pickReplyFromParsed(parsed);
    return {
      assistantReply,
      recommendations: validateRecommendationOutput(
        (parsed as Record<string, unknown>).recommendations as unknown[],
      ),
    };
  }
  throw new Error("invalid recommendation output");
}

export function createRecommendationAgent({ runModel }: { runModel: RunModel }) {
  return {
    async recommend({
      query,
      artists,
      preferenceContext = "",
      messages = [],
    }: {
      query: string;
      artists: Array<{ name: string; score?: number }>;
      preferenceContext?: string;
      messages?: Array<{ role: string; content: string }>;
    }) {
      const parsed = await runModel({ query, artists, preferenceContext, messages });
      const normalized = normalizeModelPayload(parsed);
      let { assistantReply } = normalized;
      const { recommendations } = normalized;
      if (!assistantReply) {
        assistantReply = buildFallbackAssistantReply(query, recommendations);
      }
      return { assistantReply, recommendations };
    },
  };
}

/**
 * Extract one balanced JSON object or array from text that may include model preamble or trailing prose.
 */
export function parseModelJsonResponse(raw: string): unknown {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
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
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

export async function createLangChainRunner({ timeoutMs = 8000, apiKey }: { timeoutMs?: number; apiKey?: string } = {}) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("apiKey is required for LangChain runner");
  }

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: apiKey.trim(),
    temperature: 0.4,
  });

  return async function runModel({ query, artists, preferenceContext = "", messages = [] }: RunModelInput) {
    const artistContext = artists.map((artist) => `${artist.name} (score: ${artist.score})`).join(", ");
    const prefBlock = preferenceContext ? `\nuser_preferences: ${preferenceContext}` : "";

    const prompt: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content:
          'You recommend niche bands. Respond with a single JSON object only — never a bare JSON array. Shape: {"reply":"<string>","recommendations":[{"artist":"<string>","why":"<string>","sourceSignals":["<string>",...]}]}. ' +
          "The reply must be 2–4 sentences: acknowledge the user's taste, briefly tie the picks to their query, and ask one concrete follow-up (e.g. heavier or softer, more melodic, regional scene, era). " +
          "Recommendations: at most 3 items; sourceSignals must include agent_reasoning plus any of musicbrainz_search, user_preferences when relevant.",
      },
    ];

    for (const msg of messages) {
      if (msg.role === "user" || msg.role === "assistant") {
        prompt.push({ role: msg.role, content: String(msg.content || "") });
      }
    }

    prompt.push({
      role: "user",
      content: `query: ${query}\nartist_context: ${artistContext}${prefBlock}\nlimit: 3`,
    });

    const response = await withTimeout(model.invoke(prompt), timeoutMs);
    const raw = typeof response.content === "string" ? response.content : "";
    return parseModelJsonResponse(raw);
  };
}
