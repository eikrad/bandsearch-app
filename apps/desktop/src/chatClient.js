class BandsearchHttpError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, details?: unknown }} [opts]
   */
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = "BandsearchHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {Response} response
 */
async function ensureOk(response) {
  if (response.ok) return;
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* ignore */
  }
  const apiErr = parsed?.error;
  if (apiErr && typeof apiErr.code === "string") {
    throw new BandsearchHttpError(apiErr.message || `request failed with status ${response.status}`, {
      status: response.status,
      code: apiErr.code,
      details: apiErr.details,
    });
  }
  throw new BandsearchHttpError(`request failed with status ${response.status}`, {
    status: response.status,
    code: "http_error",
  });
}

function createChatClient({ apiBaseUrl, fetchImpl = fetch }) {
  const baseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

  return {
    async fetchRecommendations(query, mode = "fresh", priorityContext = "", messages = [], selectedArtistIds = []) {
      const body = { query, mode };
      if (priorityContext) body.priorityContext = priorityContext;
      if (messages.length > 0) body.messages = messages;
      if (Array.isArray(selectedArtistIds) && selectedArtistIds.length > 0) {
        body.selectedArtistIds = selectedArtistIds.filter((id) => typeof id === "string");
      }
      const response = await fetchImpl(`${baseUrl}/recommendations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      await ensureOk(response);
      return response.json();
    },
    async createPreference(savedBand) {
      const response = await fetchImpl(`${baseUrl}/preferences`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(savedBand),
      });
      await ensureOk(response);
      return response.json();
    },
    async updatePreference(id, updates) {
      const response = await fetchImpl(`${baseUrl}/preferences/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      await ensureOk(response);
      return response.json();
    },
    async listPreferences() {
      const response = await fetchImpl(`${baseUrl}/preferences`);
      await ensureOk(response);
      const data = /** @type {any} */ (await response.json());
      return data.savedBands || [];
    },
    async deletePreference(id) {
      const response = await fetchImpl(`${baseUrl}/preferences/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await ensureOk(response);
      return response.json();
    },
    async fetchSavedBands() {
      const response = await fetchImpl(`${baseUrl}/preferences`, { method: "GET" });
      await ensureOk(response);
      return response.json();
    },
    async searchArtists(query) {
      const response = await fetchImpl(
        `${baseUrl}/artists/search?query=${encodeURIComponent(query)}`,
      );
      await ensureOk(response);
      return response.json();
    },
    async createSession(title = "Untitled") {
      const response = await fetchImpl(`${baseUrl}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await ensureOk(response);
      return response.json();
    },
    async listSessions() {
      const response = await fetchImpl(`${baseUrl}/sessions`, { method: "GET" });
      await ensureOk(response);
      return response.json();
    },
    async appendSessionMessage(sessionId, message) {
      const response = await fetchImpl(
        `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(message),
        },
      );
      await ensureOk(response);
      return response.json();
    },
  };
}

function createInitialChatState() {
  return {
    messages: [],
  };
}

function buildLocalAssistantFallback(recommendations, queryHint = "") {
  const names = Array.isArray(recommendations)
    ? recommendations.map((r) => r && r.artist).filter((n) => typeof n === "string" && n.trim())
    : [];
  const tail = names.length
    ? `: ${names.slice(0, 3).join(", ")}. Want to go heavier or softer, or narrow the era or region next?`
    : ". Want to refine the direction — heavier, softer, or a specific scene?";
  const q = typeof queryHint === "string" ? queryHint.trim().slice(0, 160) : "";
  const head = q ? `Here are some picks tied to "${q}"` : "Here are some picks to explore";
  return `${head}${tail}`;
}

function applyAssistantMessage(state, recommendationResponse) {
  let assistantReply =
    typeof recommendationResponse.assistantReply === "string"
      ? recommendationResponse.assistantReply.trim()
      : "";
  if (!assistantReply && Array.isArray(recommendationResponse.recommendations)) {
    const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
    assistantReply = buildLocalAssistantFallback(
      recommendationResponse.recommendations,
      lastUser && typeof lastUser.content === "string" ? lastUser.content : "",
    );
  }
  const nextMessage = {
    role: "assistant",
    content: assistantReply,
    recommendations: recommendationResponse.recommendations,
    meta: recommendationResponse.meta,
  };

  return {
    ...state,
    messages: [...state.messages, nextMessage],
  };
}

function normalizeArtistId(artistName) {
  return `local-${String(artistName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

module.exports = {
  BandsearchHttpError,
  createChatClient,
  createInitialChatState,
  applyAssistantMessage,
  normalizeArtistId,
};
