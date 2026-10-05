# ADR 0004 — LLM models per role, on Scaleway

**Status:** Accepted for the structure; **model choices provisional** until the
model comparison in #237 step 3 replaces them with measured ones.
**Date:** 2026-10-05

## Context

Three roles call an LLM, and until now each chose its model differently:

| Role | Was | Problem |
|---|---|---|
| Research graph (planner, extractor, reflector, ranker) | `gemini-2.5-flash`, a default repeated in four node files | no single value to report as provenance (#134) |
| Live judge | `mistral-large-latest` via `MISTRAL_JUDGE_MODEL`, own fetch code | a moving alias: scores compared over time came from different models |
| Calibration | `claude-opus-4-8`, hard-coded, `ANTHROPIC_API_KEY` | never ran, and would have calibrated a judge production does not use (#204) |

The owner wants every LLM call on Scaleway Generative APIs instead of Google
and Mistral's own API, as in the Radiationsafety project: OpenAI-compatible,
hosted in France, one key for many open models.

## Decision

1. **One place for model config:** `services/api/src/config/models.ts`
   (`resolveLlmConfig`). Every role gets a `{ provider, model }` from there;
   the response's `meta.model` and every judge score row name the model that
   ran.
2. **One client for every Scaleway call:** `llm/scalewayChat.ts`, LangChain's
   `ChatOpenAI` against `https://api.scaleway.ai/v1` (LangSmith tracing kept),
   Chat Completions only, one retry so a node's time budget holds.
3. **Calibration uses the production judge call** (`judgeBands`), so a
   calibration result always describes the judge that scores live traffic.
   Runs are recorded in `services/eval/history/judge-runs.jsonl`.
4. **Judge independence:** the judge must not be the research model (startup
   error) and should come from a different model family (startup warning);
   judges favour output from their own family (MT-Bench self-enhancement).
5. **Pinned model ids**, never moving aliases, for every role.
6. **Reasoning off by default.** Scaleway enables reasoning on every model
   that has it; every call sends `reasoning_effort: "none"` (the counterpart of
   Gemini's `thinkingBudget: 0`) unless `SCW_REASONING_EFFORT` /
   `SCW_JUDGE_REASONING_EFFORT` ask for more. Measured on one 40-hit
   extraction: gemma 101 s with reasoning, 9.1 s without; Gemini 2.5 Flash
   about 12 s.

Rollout follows #237: measure first (golden-run history and a Gemini
baseline, #242/#247), switch behind `LLM_PROVIDER` (this step, default still
`gemini`), compare models, switch the default, remove Gemini.

## Provisional model choices

| Role | Env | Default | Why, for now |
|---|---|---|---|
| Research (Scaleway) | `SCW_MODEL` | `gemma-4-26b-a4b-it` | best measured answer model in Radiationsafety; 1.9 s for a short JSON answer |
| Judge | `SCW_JUDGE_MODEL` | `mistral-medium-3.5-128b` | not a reasoning model (`qwen3.5-397b-a17b` took 91 s for a one-line answer); different family from both research models; first calibration: 97.3% agreement with the 25 human labels, 89.5% of the directional checks |
| Research (Gemini, until removed) | `GEMINI_MODEL` | `gemini-2.5-flash` | unchanged baseline |

These are replaced by the model comparison: judge candidates by calibration
first, then research candidates on the golden set against the Gemini
baseline, judged on quality, latency, failure rate and cost.

## Consequences

- Self-hosters need one LLM key (`SCW_SECRET_KEY`) once Gemini is gone.
- `MISTRAL_API_KEY`, `MISTRAL_JUDGE_ENDPOINT`, `MISTRAL_JUDGE_MODEL` and
  `ANTHROPIC_API_KEY` are no longer read.
- The privacy policy names Scaleway as the optional quality-scoring recipient.
- Reasoning models are usable as judges only if their reasoning can be
  limited; their `<think>` blocks are ignored when parsing JSON.
