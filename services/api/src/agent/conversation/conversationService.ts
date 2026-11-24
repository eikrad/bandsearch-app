import { findArtist } from "../../../../../shared/schemas/src/artistIdentity.js";
import type { AnswerProgress, ChatMessage, RecommendationMode, TurnKind } from "../../../../../shared/schemas/src/contracts.js";
import { errorMessage, type ChatModelClient } from "../modelUtils.js";
import { filterCandidatesByObscurity, type VerifiedCandidate } from "../research/candidateVerifier.js";
import { createRecommendationRanker } from "../research/recommendationRanker.js";
import { createResearchBudget, RANKING_RESERVE_MS } from "../research/researchBudget.js";
import {
  invokeResearchGraph,
  type PipelineDiagnostics,
  type ResearchGraphDeps,
  type ResearchGraphInput,
} from "../research/researchGraph.js";
import { writeAnswer } from "./answerWriter.js";
import { isShown, shownBands, type Conversation, type ConversationMemory } from "./conversationMemory.js";
import { routeTurn } from "./turnRouter.js";

const ROUTE_TIMEOUT_MS = 4000;
/** A pick asks the same ranker as a search, so it gets the same time (#369). */
const PICK_TIMEOUT_MS = RANKING_RESERVE_MS;
const ANSWER_TIMEOUT_MS = 12_000;
/** Fewer unseen bands than one answer shows are not worth picking from. */
const MIN_UNSEEN = 3;
const MAX_REMEMBERED_ANSWERS = 20;

export type TurnRequest = {
  query: string;
  mode: RecommendationMode;
  preferenceContext: string;
  messages: ChatMessage[];
  obscurityTarget?: string;
  /** Null for a one-off question: it always searches and is not remembered. */
  conversationKey: string | null;
};

/** Follows an answer while it is made, and can end it. */
export type TurnListener = {
  onProgress?: (progress: AnswerProgress) => void;
  onReply?: (text: string) => void;
  signal?: AbortSignal;
};

export type TurnResult = {
  turn: TurnKind;
  recommendations: unknown[];
  assistantReply: string;
  pipelineDiagnostics: PipelineDiagnostics | null;
  model: string;
};

export type ConversationDeps = {
  graphDeps: ResearchGraphDeps;
  memory: ConversationMemory;
  /** The model id reported for turns that do not search. */
  model: string;
};

/**
 * Answers one message of a conversation. The first message searches; a
 * follow-up is answered from what the conversation already found whenever that
 * is enough, which takes seconds instead of a whole search.
 */
export function createConversationService({ graphDeps, memory, model }: ConversationDeps) {
  const log = graphDeps.onLog ?? (() => {});

  function modelAt(temperature: number): ChatModelClient | null {
    return graphDeps.modelClient ?? graphDeps.chatModel?.({ temperature }) ?? null;
  }

  async function within<T>(ms: number, cancelled: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    cancelled?.throwIfAborted();
    const budget = createResearchBudget(ms);
    const stop = () => budget.close();
    cancelled?.addEventListener("abort", stop, { once: true });
    try {
      return await budget.run(ms, work);
    } finally {
      cancelled?.removeEventListener("abort", stop);
      budget.close();
    }
  }

  /** Found bands the user has not seen, fit for the requested target; none when the target changed since the search. */
  function unseenBands(conversation: Conversation | undefined, obscurityTarget: string | undefined): VerifiedCandidate[] {
    if (!conversation || conversation.obscurityTarget !== obscurityTarget) return [];
    return filterCandidatesByObscurity(conversation.candidates.filter((c) => !isShown(c, conversation)), obscurityTarget);
  }

  async function route(request: TurnRequest, conversation: Conversation | undefined, unseen: VerifiedCandidate[], listener: TurnListener): Promise<TurnKind> {
    const router = modelAt(0);
    if (request.messages.length === 0 || !router) return "search";
    listener.onProgress?.({ stage: "thinking" });
    try {
      const decided = await within(ROUTE_TIMEOUT_MS, listener.signal, (signal) =>
        routeTurn(router, { query: request.query, messages: request.messages, shown: conversation?.shown ?? [], unseen }, { signal, timeoutMs: ROUTE_TIMEOUT_MS }));
      return decided === null || (decided === "pick" && unseen.length < MIN_UNSEEN) ? "search" : decided;
    } catch (error) {
      listener.signal?.throwIfAborted();
      log("warn", "conversation_route_failed", { reason: errorMessage(error) });
      return "search";
    }
  }

  /** The conversation after an answer showed these bands. */
  function remember(request: TurnRequest, conversation: Conversation, recommendations: unknown[]) {
    if (!request.conversationKey) return;
    const shown = recommendations.flatMap((r) => {
      const artist = String((r as { artist?: unknown }).artist ?? "").trim();
      return (artist && findArtist({ name: artist }, conversation.candidates)) || [];
    });
    memory.set(request.conversationKey, {
      ...conversation,
      shown: shown.length > 0 ? [...conversation.shown, shown].slice(-MAX_REMEMBERED_ANSWERS) : conversation.shown,
    });
  }

  async function search(request: TurnRequest, conversation: Conversation | undefined, listener: TurnListener): Promise<TurnResult> {
    const input: ResearchGraphInput = {
      userQuery: request.query,
      preferenceContext: request.preferenceContext,
      messages: request.messages,
      mode: request.mode,
      obscurityTarget: request.obscurityTarget,
      exclude: conversation ? shownBands(conversation) : undefined,
    };
    const { candidates, ...result } = await invokeResearchGraph({ ...graphDeps, ...listener }, input);
    remember(request, {
      candidates,
      shown: conversation?.shown ?? [],
      obscurityTarget: request.obscurityTarget,
      diagnostics: result.pipelineDiagnostics,
    }, result.recommendations);
    return { turn: "search", ...result };
  }

  /** Ranks the unseen bands; null when none of them fits after all. */
  async function pick(
    request: TurnRequest,
    conversation: Conversation,
    unseen: VerifiedCandidate[],
    listener: TurnListener,
  ): Promise<TurnResult | null> {
    listener.onProgress?.({ stage: "choosing", candidates: unseen.length });
    const { recommendations, assistantReply } = await within(PICK_TIMEOUT_MS, listener.signal, async (signal) => {
      const rank = await createRecommendationRanker({
        timeoutMs: PICK_TIMEOUT_MS,
        signal,
        modelClient: graphDeps.modelClient,
        chatModel: graphDeps.chatModel,
      });
      return rank({
        query: request.query,
        preferenceContext: request.preferenceContext,
        messages: request.messages,
        mode: request.mode,
        candidates: unseen,
        obscurityTarget: request.obscurityTarget,
        onReply: listener.onReply,
      });
    });
    if (recommendations.length === 0) return null;
    remember(request, conversation, recommendations);
    return {
      turn: "pick",
      recommendations,
      assistantReply,
      // The search these bands come from; this turn itself asked no search engine.
      pipelineDiagnostics: { ...conversation.diagnostics, searchBudgetUsed: 0 },
      model,
    };
  }

  async function answer(request: TurnRequest, conversation: Conversation | undefined, listener: TurnListener): Promise<TurnResult> {
    const writer = modelAt(0.4);
    if (!writer) throw new Error("no chat model configured");
    const assistantReply = await within(ANSWER_TIMEOUT_MS, listener.signal, (signal) => writeAnswer(
      writer,
      { query: request.query, messages: request.messages, shown: conversation?.shown ?? [] },
      { signal, timeoutMs: ANSWER_TIMEOUT_MS, onReply: listener.onReply },
    ));
    return { turn: "answer", recommendations: [], assistantReply, pipelineDiagnostics: null, model };
  }

  return {
    async respond(request: TurnRequest, listener: TurnListener = {}): Promise<TurnResult> {
      const conversation = request.conversationKey ? memory.get(request.conversationKey) : undefined;
      const unseen = unseenBands(conversation, request.obscurityTarget);
      const turn = request.conversationKey ? await route(request, conversation, unseen, listener) : "search";
      log("info", "conversation_turn", { turn, unseen: unseen.length, shown: conversation?.shown.flat().length ?? 0 });

      if (turn === "answer") return answer(request, conversation, listener);
      if (turn === "pick" && conversation) {
        try {
          const picked = await pick(request, conversation, unseen, listener);
          if (picked) return picked;
          log("info", "conversation_pick_empty", {});
        } catch (error) {
          listener.signal?.throwIfAborted();
          log("warn", "conversation_pick_failed", { reason: errorMessage(error) });
        }
      }
      return search(request, conversation, listener);
    },
  };
}
