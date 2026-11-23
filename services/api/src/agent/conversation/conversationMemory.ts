import { CONVERSATION_MEMORY_HOURS } from "../../../../../shared/schemas/src/contracts.js";
import { createTtlCache } from "../../integrations/ttlCache.js";
import type { VerifiedCandidate } from "../research/candidateVerifier.js";
import type { PipelineDiagnostics } from "../research/researchGraph.js";

/** What a conversation has found and shown so far. */
export type Conversation = {
  /** Every candidate of the latest search, with its evidence. */
  candidates: VerifiedCandidate[];
  /** The bands of each answer, oldest first. */
  shown: VerifiedCandidate[][];
  /** The target the latest search looked for. */
  obscurityTarget: string | undefined;
  diagnostics: PipelineDiagnostics;
};

export type ConversationMemory = {
  get(key: string): Conversation | undefined;
  set(key: string, conversation: Conversation): void;
  /** Drops everything remembered for a user, when their account is deleted. */
  forgetUser(userId: string): void;
};

/**
 * Found bands per conversation, so a follow-up need not search again. In
 * memory and for CONVERSATION_MEMORY_HOURS only; it holds bands and their public evidence,
 * never what the user wrote. After that, or after a restart, a follow-up
 * simply searches.
 */
export function createConversationMemory(): ConversationMemory {
  const cache = createTtlCache<Conversation>({ ttlMs: CONVERSATION_MEMORY_HOURS * 60 * 60 * 1000, maxEntries: 300 });
  return {
    get: cache.get,
    set: cache.set,
    forgetUser(userId) {
      cache.deleteWhere((key) => (JSON.parse(key) as [string | null, string])[0] === userId);
    },
  };
}

/** Bands known to one user's conversation only: the user comes from authentication, never from the request body. */
export function conversationKey(userId: string | undefined, conversationId: string | undefined): string | null {
  return conversationId ? JSON.stringify([userId ?? null, conversationId]) : null;
}

export const bandName = (c: VerifiedCandidate) => c.canonicalName || c.name;

/** The names of every band shown, in lower case, under each spelling it is known by. */
export function shownNames(conversation: Conversation): Set<string> {
  return new Set(conversation.shown.flat().flatMap((c) => [c.name, bandName(c)]).map((n) => n.trim().toLowerCase()));
}

export function isShown(candidate: VerifiedCandidate, shown: Set<string>): boolean {
  return [candidate.name, bandName(candidate)].some((n) => shown.has(n.trim().toLowerCase()));
}
