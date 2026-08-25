import type {
  ArtistGroup,
  ArtistSearchResult,
  ChatSession,
  RecommendationItem,
  RecommendationMeta,
  RecommendationResponse,
  SavedBand,
} from "./domain.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSavedBand(value: unknown): value is SavedBand {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return false;
  }
  if (value.rating !== undefined && value.rating !== null && typeof value.rating !== "number") {
    return false;
  }
  if (value.note !== undefined && typeof value.note !== "string") {
    return false;
  }
  if (
    value.categories !== undefined &&
    (!Array.isArray(value.categories) || !value.categories.every((category) => typeof category === "string"))
  ) {
    return false;
  }
  return value.musicbrainzArtistId === undefined || typeof value.musicbrainzArtistId === "string";
}

function parseSavedBandResponse(data: unknown, operation: string): { savedBand: SavedBand } {
  if (!isRecord(data) || !isSavedBand(data.savedBand)) {
    throw new Error(`invalid ${operation} response: savedBand must be a valid saved band`);
  }
  return { savedBand: data.savedBand };
}

function parseSavedBandsResponse(data: unknown, operation: string): { savedBands: SavedBand[] } {
  if (!isRecord(data) || !Array.isArray(data.savedBands) || !data.savedBands.every(isSavedBand)) {
    throw new Error(`invalid ${operation} response: savedBands must be an array of valid saved bands`);
  }
  return { savedBands: data.savedBands };
}

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
      signal?: AbortSignal,
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
        signal,
      });
      await ensureOk(response);
      return response.json() as Promise<RecommendationResponse>;
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
      const data: unknown = await response.json();
      return parseSavedBandResponse(data, "create preference");
    },

    async updatePreference(id: string, updates: unknown) {
      const response = await fetchImpl(`${baseUrl}/preferences/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify(updates),
      });
      await ensureOk(response);
      const data: unknown = await response.json();
      return parseSavedBandResponse(data, "update preference");
    },

    async listPreferences() {
      const response = await fetchImpl(`${baseUrl}/preferences`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      const data: unknown = await response.json();
      return parseSavedBandsResponse(data, "list preferences").savedBands;
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
      const data: unknown = await response.json();
      return parseSavedBandsResponse(data, "fetch saved bands");
    },

    async searchArtists(query: string) {
      const response = await fetchImpl(
        `${baseUrl}/artists/search?query=${encodeURIComponent(query)}`,
        { headers: jsonHeaders() },
      );
      await ensureOk(response);
      return response.json() as Promise<{ artists: ArtistSearchResult[] }>;
    },

    async createSession(title = "Untitled") {
      const response = await fetchImpl(`${baseUrl}/sessions`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title }),
      });
      await ensureOk(response);
      return response.json() as Promise<{ session: ChatSession }>;
    },

    async listSessions() {
      const response = await fetchImpl(`${baseUrl}/sessions`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      return response.json() as Promise<{ sessions: ChatSession[] }>;
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

    async exportPreferences() {
      const response = await fetchImpl(`${baseUrl}/preferences/export`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      return response.json() as Promise<unknown[]>;
    },

    /**
     * GDPR Art. 15/20: everything the app holds about this account.
     * Distinct from exportPreferences, which is the narrower,
     * import-compatible artist backup.
     */
    async exportAccountData() {
      const response = await fetchImpl(`${baseUrl}/account/export`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      return response.json() as Promise<Record<string, unknown>>;
    },

    async importPreferences(bands: unknown[]) {
      const response = await fetchImpl(`${baseUrl}/preferences/import`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(bands),
      });
      await ensureOk(response);
      return response.json() as Promise<{ imported: number; skipped: number; failed: number }>;
    },

    async listGroups() {
      const response = await fetchImpl(`${baseUrl}/preferences/groups`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      const data = await response.json() as { groups?: ArtistGroup[] };
      return data.groups || [];
    },

    async createGroup(name: string) {
      const response = await fetchImpl(`${baseUrl}/preferences/groups`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ name }),
      });
      await ensureOk(response);
      return response.json();
    },

    async deleteGroup(id: string) {
      const response = await fetchImpl(`${baseUrl}/preferences/groups/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: jsonHeaders(),
      });
      await ensureOk(response);
      return response.json();
    },

    async autoGroup() {
      const response = await fetchImpl(`${baseUrl}/preferences/groups/auto`, {
        method: "POST",
        headers: jsonHeaders(),
      });
      await ensureOk(response);
      const data = await response.json() as { groups?: ArtistGroup[] };
      return data.groups || [];
    },
  };
}

export type ChatClient = ReturnType<typeof createChatClient>;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  recommendations?: RecommendationItem[];
  meta?: RecommendationMeta;
};
export type ChatState = { messages: ChatMessage[]; savedBands: unknown[]; selectedArtistIds: string[]; currentSessionId: string | null };

export function createInitialChatState(): Pick<ChatState, "messages"> {
  return { messages: [] };
}

export function buildLocalAssistantFallback(
  recommendations: RecommendationItem[],
  queryHint = "",
): string {
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

// Only `messages` is read; everything else is passed through untouched. Taking
// the narrower shape lets callers hand over the result of
// createInitialChatState(), which does not carry the rest of ChatState yet.
export function applyAssistantMessage<S extends Pick<ChatState, "messages">>(
  state: S,
  recommendationResponse: RecommendationResponse,
): S {
  let assistantReply = recommendationResponse.assistantReply?.trim() ?? "";
  if (!assistantReply && Array.isArray(recommendationResponse.recommendations)) {
    const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
    assistantReply = buildLocalAssistantFallback(
      recommendationResponse.recommendations,
      lastUser && typeof lastUser.content === "string" ? lastUser.content : "",
    );
  }
  const nextMessage: ChatMessage = {
    role: "assistant",
    content: assistantReply,
    recommendations: recommendationResponse.recommendations,
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
