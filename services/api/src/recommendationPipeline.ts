import type { ChatMessage } from "../../../shared/schemas/src/contracts.js";
import { createMusicBrainzQueryPlanner } from "./agent/musicBrainzQueryPlanner.js";
import { createRecommendationAgent, createLangChainRunner } from "./agent/recommendationAgent.js";
import { createResearchRecommendationService } from "./agent/research/researchService.js";
import { createMusicBrainzClient } from "./integrations/musicbrainz.js";
import type { RecommendationError } from "./recommendations.js";
import {
  createRecommendationError,
  createRecommendationService,
  resolveRecommendationFacadeInput,
} from "./recommendations.js";
import { writeStructuredLog } from "./http/structuredLog.js";

export type RecommendationPipelineMode = "classic" | "research";

export type RecommendationRuntimeConfig = {
  musicBrainzTimeoutMs?: number;
  musicBrainzRetries?: number;
  recommendationTimeoutMs?: number;
  geminiApiKey?: string;
  braveApiKey?: string;
  /** Typically `classic` or `research` from RECOMMENDATION_PIPELINE env */
  recommendationPipeline?: string;
  researchMaxInitialSearches?: number;
  researchMaxReflectionSearches?: number;
  researchTotalSearchBudget?: number;
  researchTimeoutMs?: number;
  researchTargetVerifiedCandidates?: number;
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

  let activeService:
    | ReturnType<typeof createRecommendationService>
    | ReturnType<typeof createResearchRecommendationService>
    | null = null;
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
      const apiKey = String(cfg.geminiApiKey ?? "").trim();
      const recommendTimeoutMs = cfg.recommendationTimeoutMs ?? 8000;
      const pipelineMode = (cfg.recommendationPipeline ?? "classic").trim().toLowerCase();
      const braveKey = String(cfg.braveApiKey ?? "").trim();

      if (pipelineMode === "research" && braveKey) {
        activeService = createResearchRecommendationService({
          graphDeps: {
            geminiApiKey: apiKey,
            braveApiKey: braveKey,
            maxInitialSearches: cfg.researchMaxInitialSearches ?? 6,
            maxReflectionSearches: cfg.researchMaxReflectionSearches ?? 4,
            totalSearchBudget: cfg.researchTotalSearchBudget ?? 10,
            targetVerifiedCount: cfg.researchTargetVerifiedCandidates ?? 8,
            researchTimeoutMs: cfg.researchTimeoutMs ?? 25000,
            musicBrainzTimeoutMs: cfg.musicBrainzTimeoutMs,
            musicBrainzRetries: cfg.musicBrainzRetries,
            onLog: (level, event, details) => {
              pipelineLog(level, event, details);
            },
          },
        });
        pipelineLog("info", "recommendation_pipeline_mode", { mode: "research" });
      } else {
        if (pipelineMode === "research" && !braveKey) {
          pipelineLog("warn", "research_pipeline_fallback_no_brave_key", {
            message: "RECOMMENDATION_PIPELINE=research requires BRAVE_API_KEY; using classic pipeline",
          });
        }
        const [runModel, planMusicBrainzSearch] = await Promise.all([
          createLangChainRunner({
            timeoutMs: recommendTimeoutMs,
            apiKey,
          }),
          createMusicBrainzQueryPlanner({
            apiKey,
            timeoutMs: Math.min(4000, recommendTimeoutMs),
          }),
        ]);
        activeService = createRecommendationService({
          musicBrainzClient: createMusicBrainzClient({
            timeoutMs: cfg.musicBrainzTimeoutMs,
            retries: cfg.musicBrainzRetries,
          }),
          recommendationAgent: createRecommendationAgent({ runModel }),
          planMusicBrainzSearch,
          onMusicBrainzQueryResolved: (info) => {
            pipelineLog("info", "musicbrainz_search_query_resolved", {
              userQuery:
                info.userQuery.length > 240 ? `${info.userQuery.slice(0, 240)}…` : info.userQuery,
              resolvedMbQuery: info.resolvedMbQuery,
              plannerEnabled: info.plannerEnabled,
              differsFromUser: info.resolvedMbQuery.trim() !== info.userQuery.trim(),
            });
          },
        });
        pipelineLog("info", "recommendation_pipeline_mode", { mode: "classic" });
      }
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
