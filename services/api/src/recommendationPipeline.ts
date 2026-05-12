import type { ChatMessage } from "../../../shared/schemas/src/contracts.js";
import { createRecommendationAgent, createLangChainRunner } from "./agent/recommendationAgent.js";
import { createMusicBrainzClient } from "./integrations/musicbrainz.js";
import type { RecommendationError } from "./recommendations.js";
import {
  createRecommendationError,
  createRecommendationService,
  resolveRecommendationFacadeInput,
} from "./recommendations.js";
import { writeStructuredLog } from "./http/structuredLog.js";

export type RecommendationRuntimeConfig = {
  musicBrainzTimeoutMs?: number;
  musicBrainzRetries?: number;
  recommendationTimeoutMs?: number;
  geminiApiKey?: string;
};

export type PreferenceRepositoryPipeline = {
  buildContext: () => Promise<string>;
  buildContextForIds: (ids: string[]) => Promise<string>;
};

export type PipelineLogger = Pick<typeof console, "log" | "warn" | "error" | "info" | "debug">;

export function createRecommendationPipeline({
  runtimeConfig,
  preferenceRepository,
  retryDelayMs = 5000,
  logger = console,
}: {
  runtimeConfig?: RecommendationRuntimeConfig;
  preferenceRepository?: PreferenceRepositoryPipeline;
  retryDelayMs?: number;
  logger?: PipelineLogger;
} = {}) {
  if (
    !preferenceRepository
    || typeof preferenceRepository.buildContext !== "function"
    || typeof preferenceRepository.buildContextForIds !== "function"
  ) {
    throw createRecommendationError(
      "recommendation_configuration_error",
      "preferenceRepository.buildContext and buildContextForIds are required",
    );
  }

  const cfg = runtimeConfig ?? {};

  let resolveFirstReady: (() => void) | undefined;
  const whenReadyPromise = new Promise<void>((resolve) => {
    resolveFirstReady = resolve;
  });

  let activeService: ReturnType<typeof createRecommendationService> | null = null;
  let activeError: RecommendationError | null = createRecommendationError(
    "recommendation_initializing",
    "recommendation pipeline is initializing",
  );
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function pipelineLog(level: "info" | "warn" | "error", message: string, details: Record<string, unknown> = {}) {
    void logger;
    writeStructuredLog(level, { component: "recommendation_pipeline", message, ...details });
  }

  async function initialize() {
    try {
      const runModel = await createLangChainRunner({
        timeoutMs: cfg.recommendationTimeoutMs,
        apiKey: cfg.geminiApiKey,
      });
      activeService = createRecommendationService({
        musicBrainzClient: createMusicBrainzClient({
          timeoutMs: cfg.musicBrainzTimeoutMs,
          retries: cfg.musicBrainzRetries,
        }),
        recommendationAgent: createRecommendationAgent({ runModel }),
      });
      activeError = null;
      if (resolveFirstReady) {
        resolveFirstReady();
        resolveFirstReady = undefined;
      }
      pipelineLog("info", "recommendation pipeline ready");
    } catch (error) {
      activeService = null;
      activeError = createRecommendationError(
        "recommendation_unavailable",
        "recommendation pipeline unavailable",
        error,
      );
      pipelineLog("warn", "recommendation pipeline init failed; scheduling retry", {
        error: error instanceof Error ? error.message : "unknown error",
        retryDelayMs,
      });
      scheduleRetry();
    }
  }

  function scheduleRetry() {
    if (retryTimer) {
      return;
    }
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      await initialize();
    }, retryDelayMs);
  }

  void initialize();

  function getReadinessSnapshot() {
    return {
      ready: activeService !== null,
      initializing: activeError?.code === "recommendation_initializing",
      errorCode: activeService ? null : activeError?.code ?? null,
    };
  }

  return {
    whenReady: () => whenReadyPromise,
    getReadinessSnapshot,
    async recommend(request: Record<string, unknown> = {}) {
      if (!activeService) {
        throw activeError
          || createRecommendationError("recommendation_unavailable", "recommendation pipeline unavailable");
      }

      const { mode, preferenceContext, messages } = await resolveRecommendationFacadeInput(
        request,
        preferenceRepository,
      );

      const { recommendations, assistantReply = "" } = await activeService.getRecommendations(
        String(request.query ?? ""),
        {
          mode,
          preferenceContext,
          messages: messages as ChatMessage[],
        },
      );

      return {
        recommendations,
        assistantReply: typeof assistantReply === "string" ? assistantReply : "",
        meta: {
          modeUsed: mode,
          usedPreferenceContext: preferenceContext.length > 0,
        },
      };
    },
  };
}
