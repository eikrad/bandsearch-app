# Documentation

Index of the `docs/` folder: one line per document, saying what it is for.
Documents under **Current reference** describe the code as it is and are kept
up to date; **Historical plans** are dated and record what was planned at the
time.

## Where to start

- **Using or running Bandsearch:** the [README](../README.md), then
  [development.md](development.md) (local setup) or
  [deployment.md](deployment.md) (hosting).
- **New to the code:** [CONTEXT.md](../CONTEXT.md) (glossary), then
  [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md).
- **Changing the UI:** [design/UI_GUIDELINES.md](design/UI_GUIDELINES.md) and
  [design/UI_EXAMPLES.md](design/UI_EXAMPLES.md) are binding.
- **Changing the search:** [evaluation.md](evaluation.md) and the rule "eval in
  lockstep with the search" in [AGENTS.md](../AGENTS.md).
- **Picking up work:** [ROADMAP.md](ROADMAP.md), work queue at the top.

## Current reference

| Path | What it is for |
|------|----------------|
| [development.md](development.md) | Local development: prerequisites, desktop app and Tauri commands, calling the API, checks, translations |
| [deployment.md](deployment.md) | Running the API: configuration, storage backends, auth modes, closed-beta admin CLI, Render, privacy duties |
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | How the system works: components, routes, conversation turns, search jobs, research graph, eval layer, storage, auth |
| [evaluation.md](evaluation.md) | Offline evaluation: golden runs, replay, constraints, run history, dashboard, judge calibration, turn routing |
| [releasing.md](releasing.md) | Release process: release-please, Conventional Commits, merge rules, installer builds, signing, in-app updates |
| [ROADMAP.md](ROADMAP.md) | Work queue and the phase-by-phase record of what is done and open |
| [maintenance.md](maintenance.md) | Dependency audits, upgrade notes and the maintenance log |
| [design/UI_GUIDELINES.md](design/UI_GUIDELINES.md) | UI spec: layout, components, responsive behaviour, locked values |
| [design/UI_EXAMPLES.md](design/UI_EXAMPLES.md) | UI copy examples and interaction patterns |

## Architecture Decision Records

| Path | Decision |
|------|----------|
| [adr/README.md](adr/README.md) | Index of all ADRs |
| [adr/0001-prompt-injection-guardrails.md](adr/0001-prompt-injection-guardrails.md) | Prompt injection defence: bracket-marker envelope and length caps |
| [adr/0002-machine-written-notes-stay-out-of-the-prompt.md](adr/0002-machine-written-notes-stay-out-of-the-prompt.md) | Only a user-edited note reaches the recommendation prompt, not the model's own pre-filled explanation |
| [adr/0003-android-hosting-render-over-fly.md](adr/0003-android-hosting-render-over-fly.md) | The hosted API stays on Render Free, accepting the cold start over Fly.io's cost |
| [adr/0004-llm-models-per-role-on-scaleway.md](adr/0004-llm-models-per-role-on-scaleway.md) | Which Scaleway model runs each role (research, judge) and with what reasoning effort |
| [adr/0005-closed-beta-via-email-bound-invites.md](adr/0005-closed-beta-via-email-bound-invites.md) | Closed beta via email-bound invites and `AUTH_MODE=enforced` |
| [adr/0006-search-jobs-survive-the-client.md](adr/0006-search-jobs-survive-the-client.md) | A search runs as a job on the API that the app can leave and rejoin |

## Agent conventions

Used by AI coding agents working in this repo (see [AGENTS.md](../AGENTS.md));
not required reading for human contributors.

| Path | What it is for |
|------|----------------|
| [agents/domain.md](agents/domain.md) | How agents use `CONTEXT.md` and the ADRs |
| [agents/issue-tracker.md](agents/issue-tracker.md) | GitHub Issues conventions with the `gh` CLI |
| [agents/triage-labels.md](agents/triage-labels.md) | Triage label names |

## Historical plans

Dated plans and specs from earlier phases. They describe intent at the time
and are not kept in sync with the code; where they disagree with the current
reference, the current reference wins.

| Path | What it was for |
|------|-----------------|
| [architecture/2026-05-29-eval-architecture.md](architecture/2026-05-29-eval-architecture.md) | Eval layer design: three tiers, LLM-as-judge, feedback loop (spec of ROADMAP Phase 8) |
| [architecture/2026-05-30-phase8-implementation-plan.md](architecture/2026-05-30-phase8-implementation-plan.md) | Phase 8 implementation plan and its review findings F1–F8 |
| [architecture/2026-06-03-auto-update-plan.md](architecture/2026-06-03-auto-update-plan.md) | Auto-update plan: Tauri updater and release pipeline (Phase 10) |
| [architecture/2026-08-30-data-flow-and-eu-residency.md](architecture/2026-08-30-data-flow-and-eu-residency.md) | Where data goes per provider (compute, database, LLM, search) and the EU residency vs. sovereignty question; amended since, but no decision recorded |
| [superpowers/plans/2026-08-30-android.md](superpowers/plans/2026-08-30-android.md) | Android plan; still the spec for the open ROADMAP Phase 11 |
| [superpowers/plans/2026-08-30-in-app-update-notification.md](superpowers/plans/2026-08-30-in-app-update-notification.md) | In-app update notification plan (built, ROADMAP Phase 10) |
| [superpowers/plans/2026-08-12-complete-typescript-migration.md](superpowers/plans/2026-08-12-complete-typescript-migration.md) | TypeScript migration plan (done) |
| [superpowers/specs/2026-08-12-complete-typescript-migration-design.md](superpowers/specs/2026-08-12-complete-typescript-migration-design.md) | TypeScript migration design (done) |
| [superpowers/specs/2026-06-13-stop-retry-buttons-design.md](superpowers/specs/2026-06-13-stop-retry-buttons-design.md) | Stop and Retry buttons in the chat |
| [superpowers/specs/2026-05-12-llm-musicbrainz-query-design.md](superpowers/specs/2026-05-12-llm-musicbrainz-query-design.md) | LLM + MusicBrainz query design |
| [superpowers/specs/2026-04-30-tauri-scaffold-design.md](superpowers/specs/2026-04-30-tauri-scaffold-design.md) | Tauri desktop scaffold design |
| [superpowers/plans/2026-04-30-ui-redesign.md](superpowers/plans/2026-04-30-ui-redesign.md) | UI redesign plan (Phase 3 era) |
