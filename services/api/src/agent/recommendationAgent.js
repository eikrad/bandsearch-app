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
    const replyRaw = /** @type {any} */ (parsed).reply;
    const assistantReply = typeof replyRaw === "string" ? replyRaw.trim() : "";
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
      return normalizeModelPayload(parsed);
    },
  };
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
          'You recommend niche bands. Return only valid JSON (no markdown fences) with shape: {"reply":"<string>","recommendations":[{"artist":"<string>","why":"<string>","sourceSignals":["<string>",...]}]}. ' +
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
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(text);
    return parsed;
  };
}

module.exports = {
  createRecommendationAgent,
  createLangChainRunner,
};
