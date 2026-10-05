import type { ChatMessage } from "../../../shared/schemas/src/contracts.js";
import { createResearchRecommendationService } from "./agent/research/researchService.js";
import type { RecommendationError } from "./recommendations.js";
import {
  createRecommendationError,
  resolveRecommendationFacadeInput,
} from "./recommendations.js";
import { writeStructuredLog } from "./http/structuredLog.js";
import type { LlmConfig } from "./config/models.js";
import { createChatModelFactory } from "./llm/chatModel.js";
import { createReplayFetch } from "./integrations/replayFetch.js";

/** MusicBrainz asks for at most one request per second per IP. */
const MUSICBRAINZ_MIN_INTERVAL_MS = 1100;

/**
 * How the research graph reaches Brave, MusicBrainz and Last.fm. Normally the
 * network; with a replay directory, a recording transport whose real
 * MusicBrainz calls are spaced while replays are immediate.
 */
export function externalLookupsFor(cfg: Pick<RecommendationRuntimeConfig, "evalReplayDir">): {
  replay: boolean;
  fetchImpl?: typeof fetch;
  musicBrainzMinIntervalMs?: number;
} {
  const dir = String(cfg.evalReplayDir ?? "").trim();
  if (!dir) return { replay: false };
  return {
    replay: true,
    fetchImpl: createReplayFetch({ dir, minIntervalMsByHost: { "musicbrainz.org": MUSICBRAINZ_MIN_INTERVAL_MS } }),
    musicBrainzMinIntervalMs: 0,
  };
}
import type { SavedBandContextSource } from "./savedBandContext.js";

export type RecommendationRuntimeConfig = {
  musicBrainzTimeoutMs?: number;
  musicBrainzRetries?: number;
  geminiApiKey?: string;
  researchModel?: string;
  /** Provider and model per role; when set, the research nodes are built from it. */
  llm?: LlmConfig;
  /** Eval only: record and replay external lookups in this directory (#250). */
  evalReplayDir?: string;
  braveApiKey?: string;
  lastFmApiKey?: string;
  researchMaxInitialSearches?: number;
  researchMaxReflectionSearches?: number;
  researchTotalSearchBudget?: number;
  researchTimeoutMs?: number;
  researchTargetVerifiedCandidates?: number;
};

export type PreferenceRepositoryPipeline = SavedBandContextSource;

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
  if (!preferenceRepository || typeof preferenceRepository.listSavedBands !== "function") {
    throw createRecommendationError(
      "recommendation_configuration_error",
      "preferenceRepository.listSavedBands is required",
    );
  }

  const cfg = runtimeConfig ?? {};
  const evalReplay = String(cfg.evalReplayDir ?? "").trim() !== "";

  let resolveFirstReady: (() => void) | undefined;
  const whenReadyPromise = new Promise<void>((resolve) => {
    resolveFirstReady = resolve;
  });

  let activeService: ReturnType<typeof createResearchRecommendationService> | null = null;
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
      const apiKey = String(cfg.llm?.geminiApiKey ?? cfg.geminiApiKey ?? "").trim();
      const braveKey = String(cfg.braveApiKey ?? "").trim();
      const chatModel = cfg.llm ? createChatModelFactory(cfg.llm.research, cfg.llm) : undefined;
      const lookups = externalLookupsFor(cfg);

      activeService = createResearchRecommendationService({
        graphDeps: {
          geminiApiKey: apiKey,
          chatModel,
          model: cfg.llm?.research.model ?? cfg.researchModel,
          braveApiKey: braveKey,
          maxInitialSearches: cfg.researchMaxInitialSearches ?? 6,
          maxReflectionSearches: cfg.researchMaxReflectionSearches ?? 4,
          totalSearchBudget: cfg.researchTotalSearchBudget ?? 10,
          targetVerifiedCount: cfg.researchTargetVerifiedCandidates ?? 8,
          researchTimeoutMs: cfg.researchTimeoutMs ?? 180000,
          lastFmApiKey: String(cfg.lastFmApiKey ?? "").trim(),
          musicBrainzTimeoutMs: cfg.musicBrainzTimeoutMs,
          musicBrainzRetries: cfg.musicBrainzRetries,
          fetchImpl: lookups.fetchImpl,
          musicBrainzMinIntervalMs: lookups.musicBrainzMinIntervalMs,
          onLog: (level, event, details) => {
            pipelineLog(level, event, details);
          },
        },
      });
      pipelineLog("info", "recommendation_pipeline_mode", {
        mode: "research",
        provider: cfg.llm?.research.provider ?? "gemini",
        model: cfg.llm?.research.model ?? cfg.researchModel,
        replay: lookups.replay,
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

      const obscurityTarget = typeof request.obscurityTarget === "string" ? request.obscurityTarget : undefined;

      const { recommendations, assistantReply = "", pipelineDiagnostics, model } = await activeService.getRecommendations(
        String(request.query ?? ""),
        {
          mode,
          preferenceContext,
          messages: messages as ChatMessage[],
          obscurityTarget,
        },
      );

      return {
        recommendations,
        assistantReply: typeof assistantReply === "string" ? assistantReply : "",
        meta: {
          modeUsed: mode,
          usedPreferenceContext: preferenceContext.length > 0,
          model,
          // Eval runs record this, so a replayed run is never mistaken for a live one.
          ...(evalReplay ? { evalReplay: true } : {}),
          pipelineDiagnostics: pipelineDiagnostics ?? null,
        },
      };
    },
  };
}
