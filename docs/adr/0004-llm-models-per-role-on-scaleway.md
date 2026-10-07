# ADR 0004 — LLM models per role, on Scaleway

**Status:** Accepted. Model choices measured on 2026-10-05 (#237 step 3); see
"Measured model choices" below. The provisional choices of the first draft are
kept underneath for the record.
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
baseline, #242/#247), switch behind `LLM_PROVIDER` (#249), compare models
(#255), switch the default (2026-10-05: `LLM_PROVIDER` defaults to `scaleway`;
the desktop stores a vendor-neutral `llm_api_key` and hands it to the sidecar
as `SCW_SECRET_KEY`), then remove Gemini.

## Measured model choices (2026-10-05)

**How it was measured.** The 16-query golden set (10 open-ended, 6 constraint
queries), with recorded Brave, MusicBrainz and Last.fm answers replayed so
every model saw the same search data (#250). Three runs per model, compared
with the Gemini baseline per query: values averaged over the runs, 95% paired
bootstrap over queries. Quality was judged by `glm-5.2` (below), a judge from
a family none of the candidates belongs to.

**Judge.** Four candidates calibrated against the 25 human labels and 16
directional checks, 3 votes each with shuffled band order:

| Judge | Family | Agreement | Directional checks | Time |
|---|---|---|---|---|
| **glm-5.2** | Zhipu | **98.7%** | **100%** (after fixing ut-13) | 155 s |
| llama-3.3-70b-instruct | Meta | 96.0% | 94.4% — misses a fabricated second URL (ut-15) | 121 s |
| mistral-medium-3.5-128b | Mistral | 98.7% | 89.5% (before the ut-13 fix) | 178 s |
| gpt-oss-120b (reasoning low) | OpenAI | 92.0% | 94.7% (before the ut-13 fix); obscurity fit 76% | 283 s |

The labelled set separates judges poorly: three reach 98.7% because it only
distinguishes high from low. Finer judge comparisons need harder,
owner-labelled borderline cases.

**Research model.** Differences against Gemini 2.5 Flash; `*` marks an
interval that excludes zero:

| Model | Pass | Constraint hits | Judge quality | Median latency | Unanswered | Δ constraints | Δ judge quality |
|---|---|---|---|---|---|---|---|
| gemini-2.5-flash (baseline) | 56% | 71% | 71% | 29 s | 0% | — | — |
| gemma-4-26b-a4b-it | 51% | 48% | 65% | 38 s | 6% | −36 pp [−65, −7] * | −6 pp [−11, −1] * |
| **deepseek-v4-flash-0731** | 66% | 77% | 71% | 40 s | 2% | +6 pp [0, +13] | +1 pp [−4, +5] |
| mistral-small-3.2-24b | 47% | 84% | 67% | 33 s | 21% | +9 pp [−27, +58] | −3 pp [−9, +2] |

**Decision:** research `deepseek-v4-flash-0731`, judge `glm-5.2`, both with
reasoning off.

- deepseek is the only candidate that is at least on par with Gemini on every
  measure; none of its differences is outside the noise.
- gemma extracts fastest (9 s) but ignores hard constraints far more often
  and scores lower with the judge.
- mistral-small times out in the 12 s extraction budget on a fifth of the
  queries; with a larger budget it might be viable, but that budget is
  latency every user pays.

**Trade-off accepted:** median latency per query rises from ~29 s to ~40 s
(with replayed lookups; live MusicBrainz adds the same to both). Cost per
query was not measured; Scaleway bills per token for every candidate.

## Provisional model choices (first draft, superseded)

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
