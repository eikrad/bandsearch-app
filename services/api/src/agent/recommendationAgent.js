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

function createRecommendationAgent({ runModel }) {
  return {
    async recommend({ query, artists, preferenceContext = "", messages = [] }) {
      const output = await runModel({ query, artists, preferenceContext, messages });
      return validateRecommendationOutput(output);
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

async function createLangChainRunner({ timeoutMs = 8000 } = {}) {
  const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for LangChain runner");
  }

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
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
          "You recommend niche bands. Return only valid JSON array with objects: {artist, why, sourceSignals[]}.",
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
