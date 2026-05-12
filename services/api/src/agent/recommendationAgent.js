const { validateRecommendationItem } = require("../../../../shared/schemas/src/contracts");

function isValidRecommendation(item) {
  return validateRecommendationItem(item).ok;
}

function validateRecommendationOutput(output) {
  if (!Array.isArray(output) || output.some((item) => !isValidRecommendation(item))) {
    throw new Error("invalid recommendation output");
  }
  return output;
}

/**
 * @param {unknown} parsed
 */
function pickReplyFromParsed(parsed) {
  if (!parsed || typeof parsed !== "object") return "";
  const p = /** @type {Record<string, unknown>} */ (parsed);
  const candidates = [p.reply, p.assistant_reply, p.message, p.summary, p.narrative];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

/**
 * When the model omits prose (common when it returns a bare JSON array), still give the UI a short dialogue turn.
 *
 * @param {string} query
 * @param {unknown[]} recommendations
 */
function buildFallbackAssistantReply(query, recommendations) {
  const names = recommendations
    .map((r) => (r && typeof r === "object" ? /** @type {any} */ (r).artist : null))
    .filter((n) => typeof n === "string" && n.trim());
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
 *
 * @param {unknown} parsed
 * @returns {{ assistantReply: string, recommendations: unknown[] }}
 */
function normalizeModelPayload(parsed) {
  if (Array.isArray(parsed)) {
    return { assistantReply: "", recommendations: validateRecommendationOutput(parsed) };
  }
  if (parsed && typeof parsed === "object" && Array.isArray(/** @type {any} */ (parsed).recommendations)) {
    const assistantReply = pickReplyFromParsed(parsed);
    return {
      assistantReply,
      recommendations: validateRecommendationOutput(/** @type {any} */ (parsed).recommendations),
    };
  }
  throw new Error("invalid recommendation output");
}

function createRecommendationAgent({ runModel }) {
  return {
    async recommend({ query, artists, preferenceContext = "", messages = [] }) {
      const parsed = await runModel({ query, artists, preferenceContext, messages });
      let { assistantReply, recommendations } = normalizeModelPayload(parsed);
      if (!assistantReply) {
        assistantReply = buildFallbackAssistantReply(query, recommendations);
      }
      return { assistantReply, recommendations };
    },
  };
}

/**
 * Extract one balanced JSON object or array from text that may include model preamble or trailing prose.
 *
 * @param {string} raw
 */
function parseModelJsonResponse(raw) {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const objStart = text.indexOf("{");
    const arrStart = text.indexOf("[");
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
      const slice = extractBalancedSegment(text, objStart, "{", "}");
      if (slice) {
        try {
          return JSON.parse(slice);
        } catch {
          /* try array path */
        }
      }
    }
    if (arrStart !== -1) {
      const slice = extractBalancedSegment(text, arrStart, "[", "]");
      if (slice) {
        return JSON.parse(slice);
      }
    }
    throw new Error("invalid recommendation output");
  }
}

/**
 * @param {string} s
 * @param {number} startIdx
 * @param {string} open
 * @param {string} close
 */
function extractBalancedSegment(s, startIdx, open, close) {
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

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("recommendation model timeout")), timeoutMs);
    }),
  ]);
}

/**
 * @param {{ timeoutMs?: number, apiKey?: string }} [options]
 */
async function createLangChainRunner({ timeoutMs = 8000, apiKey } = {}) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("apiKey is required for LangChain runner");
  }

  const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: apiKey.trim(),
    temperature: 0.4,
  });

  return async function runModel({ query, artists, preferenceContext = "", messages = [] }) {
    const artistContext = artists
      .map((artist) => `${artist.name} (score: ${artist.score})`)
      .join(", ");
    const prefBlock = preferenceContext ? `\nuser_preferences: ${preferenceContext}` : "";

    const prompt = [
      {
        role: "system",
        content:
          'You recommend niche bands. Respond with a single JSON object only — never a bare JSON array. Shape: {"reply":"<string>","recommendations":[{"artist":"<string>","why":"<string>","sourceSignals":["<string>",...]}]}. ' +
          "The reply must be 2–4 sentences: acknowledge the user's taste, briefly tie the picks to their query, and ask one concrete follow-up (e.g. heavier or softer, more melodic, regional scene, era). " +
          "Recommendations: at most 3 items; sourceSignals must include agent_reasoning plus any of musicbrainz_search, user_preferences when relevant.",
      },
    ];

    // Inject conversation history before the current query
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

module.exports = {
  createRecommendationAgent,
  createLangChainRunner,
};
