/**
 * Which model fills which role, read from the environment in one place.
 *
 * The research graph and the judge used to pick their models in different
 * files (four node defaults, a judge env var, a hard-coded calibration model),
 * so no single value could be reported as a response's provenance (EU AI Act
 * Art. 50(2), #134) and calibration did not even use the production judge
 * (#204). Every model now comes from here; see ADR 0004 for the choices.
 */

export type LlmProvider = "gemini" | "scaleway";

export const LLM_PROVIDERS: readonly LlmProvider[] = ["gemini", "scaleway"];

export type ModelRef = {
  provider: LlmProvider;
  model: string;
  /** Scaleway only: reasoning_effort sent with every call; "none" unless configured. */
  reasoningEffort?: string;
};

/** Default research model on Gemini, the provider being migrated away from (#237). */
export const DEFAULT_RESEARCH_MODEL = "gemini-2.5-flash";

/**
 * Scaleway defaults, chosen by measurement on 2026-10-05 (ADR 0004, #237).
 *
 * Research: deepseek-v4-flash-0731 was the only candidate on par with the
 * Gemini baseline on every golden metric (judge quality +1 pp, constraint
 * hits +6 pp, both within noise) with 2% unanswered queries; gemma was
 * clearly worse on constraints and judge quality, mistral-small timed out on
 * 21% of queries. Judge: glm-5.2, 98.7% agreement with the human labels and
 * every directional check, from a family none of the research models uses.
 */
export const DEFAULT_SCALEWAY_RESEARCH_MODEL = "deepseek-v4-flash-0731";
export const DEFAULT_SCALEWAY_JUDGE_MODEL = "glm-5.2";

export type LlmConfig = {
  research: ModelRef;
  /** Null when no judge can run (no Scaleway key): live eval scoring is then off. */
  judge: ModelRef | null;
  geminiApiKey: string;
  scalewayApiKey: string;
  /** Empty for Scaleway's default endpoint; a project-scoped URL otherwise. */
  scalewayBaseUrl: string;
  /** Configuration that runs but deserves a look, logged at startup. */
  warnings: string[];
};

/**
 * The vendor behind a model id. A judge from the same vendor as the model it
 * scores tends to prefer that model's output (self-preference, MT-Bench), so
 * the two must differ by model and should differ by family.
 */
export function modelFamily(model: string): string {
  const id = model.toLowerCase();
  const vendors: Array<[RegExp, string]> = [
    [/^(gemini|gemma)/, "google"],
    [/^(mistral|pixtral|magistral|devstral|codestral)/, "mistral"],
    [/^(qwen|qwq)/, "alibaba"],
    [/^llama/, "meta"],
    [/^deepseek/, "deepseek"],
    [/^glm/, "zhipu"],
    [/^gpt/, "openai"],
  ];
  return vendors.find(([pattern]) => pattern.test(id))?.[1] ?? id.split(/[-_.\d]/)[0] ?? id;
}

function trimmed(value: string | undefined): string {
  return String(value ?? "").trim();
}

export function resolveLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const providerSetting = trimmed(env.LLM_PROVIDER).toLowerCase() || "gemini";
  if (!LLM_PROVIDERS.includes(providerSetting as LlmProvider)) {
    throw new Error(`LLM_PROVIDER must be one of ${LLM_PROVIDERS.join(", ")} (got "${providerSetting}")`);
  }
  const provider = providerSetting as LlmProvider;
  const geminiApiKey = trimmed(env.GEMINI_API_KEY);
  const scalewayApiKey = trimmed(env.SCW_SECRET_KEY);

  if (provider === "gemini" && !geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required (or set LLM_PROVIDER=scaleway)");
  }
  if (provider === "scaleway" && !scalewayApiKey) {
    throw new Error("SCW_SECRET_KEY is required when LLM_PROVIDER=scaleway");
  }

  const research: ModelRef =
    provider === "gemini"
      ? { provider, model: trimmed(env.GEMINI_MODEL) || DEFAULT_RESEARCH_MODEL }
      : {
          provider,
          model: trimmed(env.SCW_MODEL) || DEFAULT_SCALEWAY_RESEARCH_MODEL,
          reasoningEffort: trimmed(env.SCW_REASONING_EFFORT) || "none",
        };

  const judge: ModelRef | null = scalewayApiKey
    ? {
        provider: "scaleway",
        model: trimmed(env.SCW_JUDGE_MODEL) || DEFAULT_SCALEWAY_JUDGE_MODEL,
        reasoningEffort: trimmed(env.SCW_JUDGE_REASONING_EFFORT) || "none",
      }
    : null;

  const warnings: string[] = [];
  if (judge) {
    if (judge.model === research.model) {
      throw new Error(`The judge (${judge.model}) must not be the research model: it would score its own output`);
    }
    const family = modelFamily(judge.model);
    if (family === modelFamily(research.model)) {
      warnings.push(
        `The judge (${judge.model}) and the research model (${research.model}) are from the same model family (${family}); ` +
          "a judge from another family avoids self-preference",
      );
    }
  }

  return {
    research,
    judge,
    geminiApiKey,
    scalewayApiKey,
    scalewayBaseUrl: trimmed(env.SCW_BASE_URL),
    warnings,
  };
}
