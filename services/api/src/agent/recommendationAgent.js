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
    async recommend({ query, artists }) {
      const output = await runModel({ query, artists });
      return validateRecommendationOutput(output);
    },
  };
}

async function createLangChainRunner() {
  const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required for LangChain runner");
  }

  const model = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.4,
  });

  return async function runModel({ query, artists }) {
    const artistContext = artists
      .map((artist) => `${artist.name} (score: ${artist.score})`)
      .join(", ");
    const prompt = [
      {
        role: "system",
        content:
          "You recommend niche bands. Return only valid JSON array with objects: {artist, why, sourceSignals[]}.",
      },
      {
        role: "user",
        content: `query: ${query}\nartist_context: ${artistContext}\nlimit: 3`,
      },
    ];

    const response = await model.invoke(prompt);
    const text = typeof response.content === "string" ? response.content : "";
    const parsed = JSON.parse(text);
    return parsed;
  };
}

module.exports = {
  createRecommendationAgent,
  createLangChainRunner,
};
