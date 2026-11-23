import type {
  ArtistGroup,
  ArtistSearchResult,
  ChatSession,
  RecommendationItem,
  RecommendationMeta,
  RecommendationResponse,
  SavedBand,
} from "./domain.js";
import { readAnswerEvents } from "./answerEvents.js";
import {
  MESSAGE_CONTENT_MAX_LEN,
  MESSAGES_MAX_COUNT,
  type AnswerEvent,
  type RecommendationFeedbackSubmission,
} from "../../../shared/schemas/src/contracts.js";

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
  /** Waits between attempts to re-attach to a search; tests pass one that does not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Silence after which a followed search's connection is taken for dead. */
  stallMs?: number;
};

/**
 * Waits before each new attempt to re-attach to a search whose connection
 * failed: about 15 s in all, long enough for a network to come back after the
 * screen turns on, short enough that the user is told soon. An attempt that
 * gets an event starts the count again.
 */
const REATTACH_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
/** The API sends a keep-alive every 15 s; three missed ones mean the connection is gone. */
const STALL_MS = 45_000;

export type FollowSearchOptions = {
  signal?: AbortSignal;
  /** Progress and the reply while it is written; the answer is the result. */
  onEvent?: (event: AnswerEvent) => void;
};

export type FollowedSearch = {
  /** The answer, or the error the search ended with. */
  result: Promise<RecommendationResponse>;
  /** Drops the current connection, which may be dead without knowing it, and attaches again at once. */
  reconnect(): void;
};

export type RecommendationRequest = {
  query: string;
  mode?: string;
  priorityContext?: string;
  /** Earlier messages of the conversation, oldest first; the newest that the API accepts are sent. */
  messages?: Array<{ role: string; content: string }>;
  selectedArtistIds?: string[];
  obscurityTarget?: string;
  /** The conversation this message continues, so the API can answer from what it already found. */
  conversationId?: string;
  signal?: AbortSignal;
};

function recommendationBody({
  query,
  mode = "fresh",
  priorityContext,
  messages = [],
  selectedArtistIds = [],
  obscurityTarget,
  conversationId,
}: Omit<RecommendationRequest, "signal">): Record<string, unknown> {
  const body: Record<string, unknown> = { query, mode };
  if (priorityContext) body.priorityContext = priorityContext;
  if (messages.length > 0) {
    body.messages = messages
      .slice(-MESSAGES_MAX_COUNT)
      .map((m) => ({ ...m, content: m.content.slice(0, MESSAGE_CONTENT_MAX_LEN) }));
  }
  if (selectedArtistIds.length > 0) body.selectedArtistIds = selectedArtistIds;
  if (obscurityTarget) body.obscurityTarget = obscurityTarget;
  if (conversationId) body.conversationId = conversationId;
  return body;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createChatClient({
  apiBaseUrl,
  fetchImpl = fetch,
  getToken = null,
  sleep = defaultSleep,
  stallMs = STALL_MS,
}: ChatClientOptions) {
  const baseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl.slice(0, -1) : apiBaseUrl;

  function authHeaders(): Record<string, string> {
    const token = typeof getToken === "function" ? getToken() : null;
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  function jsonHeaders(): Record<string, string> {
    return { "content-type": "application/json", ...authHeaders() };
  }

  return {
    /** Starts a search as a job on the API (ADR 0006) and returns its id; the answer is followed separately. */
    async startSearch({ signal, ...request }: RecommendationRequest): Promise<string> {
      const response = await fetchImpl(`${baseUrl}/recommendations/jobs`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(recommendationBody(request)),
        signal,
      });
      await ensureOk(response);
      const data: unknown = await response.json();
      if (!isRecord(data) || typeof data.jobId !== "string" || !data.jobId) {
        throw new BandsearchHttpError("the API did not start the search", { code: "recommendation_unavailable" });
      }
      return data.jobId;
    },

    /**
     * Follows a search job to its answer. A connection that fails, ends early
     * or goes quiet is not the search failing: it attaches again after the last
     * event seen, a few times with growing waits, before it gives up with
     * `search_disconnected` (the job may still be running). A job the API does
     * not know (restarted, or kept past its hour) is `search_lost`; one stopped
     * elsewhere, `search_cancelled`. Aborting `signal` ends it as an AbortError.
     */
    followSearch(jobId: string, { signal, onEvent }: FollowSearchOptions = {}): FollowedSearch {
      let after = 0;
      let failures = 0;
      let attempt: AbortController | null = null;
      let reconnectAsked = false;
      let wake: (() => void) | null = null;

      /** One connection: the answer, or "broken" when it is worth attaching again. */
      async function attach(): Promise<RecommendationResponse | "broken"> {
        const controller = new AbortController();
        attempt = controller;
        const forwardAbort = () => controller.abort(signal?.reason);
        signal?.addEventListener("abort", forwardAbort, { once: true });
        let stall: ReturnType<typeof setTimeout> | undefined;
        const armStall = () => {
          clearTimeout(stall);
          stall = setTimeout(() => controller.abort(new Error("the connection went quiet")), stallMs);
        };
        try {
          armStall();
          let response: Response;
          try {
            response = await fetchImpl(`${baseUrl}/recommendations/jobs/${encodeURIComponent(jobId)}${after > 0 ? `?after=${after}` : ""}`, {
              method: "GET",
              headers: { ...authHeaders(), accept: "text/event-stream" },
              signal: controller.signal,
            });
          } catch (error) {
            if (signal?.aborted) throw error;
            return "broken";
          }
          if (response.status === 404) {
            throw new BandsearchHttpError("the server no longer knows this search", { status: 404, code: "search_lost" });
          }
          // A proxy or a restarting server: the job may be there again in a moment.
          if (response.status >= 500 || response.status === 429) return "broken";
          await ensureOk(response);
          if (!response.body) return "broken";
          const watched = response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, out) { armStall(); out.enqueue(chunk); } }),
            { signal: controller.signal },
          );
          try {
            for await (const { id, event } of readAnswerEvents(watched)) {
              if (id !== null) {
                after = id;
                failures = 0;
              }
              if (event.type === "done") return event.response as RecommendationResponse;
              if (event.type === "error") {
                throw new BandsearchHttpError(event.error.message, { status: event.status, code: event.error.code });
              }
              if (event.type === "cancelled") {
                signal?.throwIfAborted();
                throw new BandsearchHttpError("the search was stopped", { code: "search_cancelled" });
              }
              onEvent?.(event);
            }
          } catch (error) {
            if (signal?.aborted || error instanceof BandsearchHttpError) throw error;
          }
          return "broken";
        } finally {
          clearTimeout(stall);
          signal?.removeEventListener("abort", forwardAbort);
          attempt = null;
        }
      }

      const result = (async () => {
        for (;;) {
          signal?.throwIfAborted();
          const outcome = await attach();
          if (outcome !== "broken") return outcome;
          signal?.throwIfAborted();
          if (reconnectAsked) {
            reconnectAsked = false;
            failures = 0;
            continue;
          }
          if (failures >= REATTACH_DELAYS_MS.length) {
            throw new BandsearchHttpError("the connection to the search dropped", { code: "search_disconnected" });
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
            signal?.addEventListener("abort", () => resolve(), { once: true });
            void sleep(REATTACH_DELAYS_MS[failures]!).then(resolve);
          });
          wake = null;
          failures += 1;
        }
      })();

      return {
        result,
        reconnect() {
          reconnectAsked = true;
          attempt?.abort(new Error("reconnecting"));
          wake?.();
        },
      };
    },

    /** Asks the API to stop a search job. */
    async stopSearch(jobId: string): Promise<void> {
      await fetchImpl(`${baseUrl}/recommendations/jobs/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
    },

    async sendFeedback(eventId: string, submission: RecommendationFeedbackSubmission) {
      const response = await fetchImpl(`${baseUrl}/recommendations/${encodeURIComponent(eventId)}/feedback`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(submission),
      });
      // A refused click is an error the user sees, not a silent drop.
      await ensureOk(response);
      return response.json() as Promise<unknown>;
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

    async createSession(title = "Untitled", signal?: AbortSignal) {
      const response = await fetchImpl(`${baseUrl}/sessions`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title }),
        signal,
      });
      await ensureOk(response);
      return response.json() as Promise<{ session: ChatSession }>;
    },

    async listSessions() {
      const response = await fetchImpl(`${baseUrl}/sessions`, { method: "GET", headers: jsonHeaders() });
      await ensureOk(response);
      return response.json() as Promise<{ sessions: ChatSession[] }>;
    },

    async getSession(sessionId: string) {
      const response = await fetchImpl(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}`, {
        method: "GET",
        headers: jsonHeaders(),
      });
      if (response.status === 404) return null;
      await ensureOk(response);
      return response.json() as Promise<{
        session: ChatSession;
        messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
      }>;
    },

    async appendSessionMessage(sessionId: string, message: unknown, signal?: AbortSignal) {
      const response = await fetchImpl(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(message),
        signal,
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
