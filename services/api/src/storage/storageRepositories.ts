import type { PreferenceRepository } from "../preferences/preferenceRepository.js";
import type { UserRepository } from "../auth/userRepository.js";
import type { InviteRepository } from "../auth/inviteRepository.js";
import type { UserDataStore } from "../privacy/userDataStore.js";
import type { ChatSessionRepository } from "../sessions/chatSessionRepository.js";
import type { TursoClient } from "../turso/tursoClient.js";
import type { RecommendationFeedbackRepository } from "../feedback/recommendationFeedback.js";
import { createTursoPreferenceRepository } from "../preferences/tursoPreferenceRepository.js";
import { createTursoUserRepository } from "../auth/tursoUserRepository.js";
import { createTursoInviteRepository } from "../auth/tursoInviteRepository.js";
import { createTursoChatSessionRepository } from "../sessions/tursoChatSessionRepository.js";
import { createTursoUserDataStore } from "../privacy/tursoUserDataStore.js";
import { createTursoFeedbackRepository } from "../feedback/tursoFeedbackRepository.js";

/**
 * The account repositories selected together for one backend. Recommendation
 * feedback is account data (#307), so it lives in the same database and
 * account export and erasure cover it.
 */
export type StorageRepositories = {
  preferenceRepository: PreferenceRepository;
  userRepository: UserRepository;
  inviteRepository: InviteRepository;
  chatSessionRepository: ChatSessionRepository;
  recommendationFeedbackRepository: RecommendationFeedbackRepository;
  /** Memory has no durable account export or erasure. */
  userDataStore: UserDataStore | null;
};

/** Both cloud and replica adapters use this complete set on their own client. */
export function createTursoRepositories(client: TursoClient): StorageRepositories {
  return {
    preferenceRepository: createTursoPreferenceRepository({ client }),
    userRepository: createTursoUserRepository({ client }),
    inviteRepository: createTursoInviteRepository({ client }),
    chatSessionRepository: createTursoChatSessionRepository({ client }),
    recommendationFeedbackRepository: createTursoFeedbackRepository({ client }),
    userDataStore: createTursoUserDataStore({ client }),
  };
}
