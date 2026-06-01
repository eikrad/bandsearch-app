export class BandsearchHttpError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, { status, code, details }: { status?: number; code?: string; details?: unknown } = {}) {
    super(message);
    this.name = "BandsearchHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  const text = await response.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch { /* ignore */ }
  const apiErr = parsed?.error as { code?: string; message?: string; details?: unknown } | undefined;
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

export type ChatClientOptions = {
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  getToken?: (() => string | null) | null;
};

export function createChatClient({ apiBaseUrl, fetchImpl = fetch, getToken = null }: ChatClientOptions) {
  const baseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

  function jsonHeaders(): Record<string, string> {
    const token = typeof getToken === "function" ? getToken() : null;
    const h: Record<string, string> = { "content-type": "application/json" };
    if (token) h["authorization"] = `Bearer ${token}`;
    return h;
  }

  return {
    async fetchRecommendations(
      query: string,
      mode = "fresh",
      priorityContext = "",
      messages: unknown[] = [],
      selectedArtistIds: string[] = [],
      obscurityTarget?: string,
    ) {
      const body: Record<string, unknown> = { query, mode };
      if (priorityContext) body.priorityContext = priorityContext;
      if (messages.length > 0) body.messages = messages;
      if (Array.isArray(selectedArtistIds) && selectedArtistIds.length > 0) {
        body.selectedArtistIds = selectedArtistIds.filter((id) => typeof id === "string");
      }
      if (obscurityTarget) body.obscurityTarget = obscurityTarget;
      const response = await fetchImpl(`${baseUrl}/recommendations`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      });
      await ensureOk(response);
      return response.json();
    },

    async sendFeedback(eventId: string, feedbackType: string) {
      const response = await fetchImpl(`${baseUrl}/eval/feedback`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ eventId, feedbackType }),
      });
      if (!response.ok) return;
      return response.json();
    },

    async createPreference(savedBand: unknown) {
      const response = await fetchImpl(`${baseUrl}/preferences`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(savedBand),
      });
      await ensureOk(response);
      return response.json();
    },

    async updatePreference(id: string, updates: unknown) {
      const response = await fetchImpl(`${baseUrl}/preferences/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify(updates),
      });
      await ensureOk(response);
      return response.json();
    },

    async listPreferences() {
      const response = await fetchImpl(`${baseUrl}/preferences`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      const data = await response.json() as { savedBands?: unknown[] };
      return data.savedBands || [];
    },

    async deletePreference(id: string) {
      const response = await fetchImpl(`${baseUrl}/preferences/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: jsonHeaders(),
      });
      await ensureOk(response);
      return response.json();
    },

    async fetchSavedBands() {
      const response = await fetchImpl(`${baseUrl}/preferences`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      return response.json();
    },

    async searchArtists(query: string) {
      const response = await fetchImpl(
        `${baseUrl}/artists/search?query=${encodeURIComponent(query)}`,
        { headers: jsonHeaders() },
      );
      await ensureOk(response);
      return response.json();
    },

    async createSession(title = "Untitled") {
      const response = await fetchImpl(`${baseUrl}/sessions`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title }),
      });
      await ensureOk(response);
      return response.json();
    },

    async listSessions() {
      const response = await fetchImpl(`${baseUrl}/sessions`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      return response.json();
    },

    async appendSessionMessage(sessionId: string, message: unknown) {
      const response = await fetchImpl(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(message),
      });
      await ensureOk(response);
      return response.json();
    },
  };
}

export type ChatClient = ReturnType<typeof createChatClient>;

export type ChatMessage = { role: "user" | "assistant"; content: string; recommendations?: unknown[]; meta?: unknown };
export type ChatState = { messages: ChatMessage[]; savedBands: unknown[]; selectedArtistIds: string[]; currentSessionId: string | null };

export function createInitialChatState(): Pick<ChatState, "messages"> {
  return { messages: [] };
}

export function buildLocalAssistantFallback(recommendations: unknown[], queryHint = ""): string {
  const names = Array.isArray(recommendations)
    ? recommendations.map((r: any) => r && r.artist).filter((n: unknown) => typeof n === "string" && (n as string).trim())
    : [];
  const tail = names.length
    ? `: ${names.slice(0, 3).join(", ")}. Want to go heavier or softer, or narrow the era or region next?`
    : ". Want to refine the direction — heavier, softer, or a specific scene?";
  const q = typeof queryHint === "string" ? queryHint.trim().slice(0, 160) : "";
  const head = q ? `Here are some picks tied to "${q}"` : "Here are some picks to explore";
  return `${head}${tail}`;
}

export function applyAssistantMessage(state: ChatState, recommendationResponse: Record<string, unknown>): ChatState {
  let assistantReply =
    typeof recommendationResponse.assistantReply === "string" ? recommendationResponse.assistantReply.trim() : "";
  if (!assistantReply && Array.isArray(recommendationResponse.recommendations)) {
    const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
    assistantReply = buildLocalAssistantFallback(
      recommendationResponse.recommendations as unknown[],
      lastUser && typeof lastUser.content === "string" ? lastUser.content : "",
    );
  }
  const nextMessage: ChatMessage = {
    role: "assistant",
    content: assistantReply,
    recommendations: recommendationResponse.recommendations as unknown[] | undefined,
    meta: recommendationResponse.meta,
  };
  return { ...state, messages: [...state.messages, nextMessage] };
}

export function normalizeArtistId(artistName: string): string {
  return `local-${String(artistName || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}
