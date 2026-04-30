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
    async recommend({ query, artists, preferenceContext = "" }) {
      const output = await runModel({ query, artists, preferenceContext });
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

  return async function runModel({ query, artists, preferenceContext = "" }) {
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
      {
        role: "user",
        content: `query: ${query}\nartist_context: ${artistContext}${prefBlock}\nlimit: 3`,
      },
    ];

    const response = await withTimeout(model.invoke(prompt), timeoutMs);
    const text = typeof response.content === "string" ? response.content : "";
    const parsed = JSON.parse(text);
    return parsed;
  };
}

module.exports = {
  createRecommendationAgent,
  createLangChainRunner,
};
