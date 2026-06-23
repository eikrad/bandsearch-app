# Documentation

Navigation guide for the `docs/` folder.

## Core reference

| Path | What it covers |
|------|----------------|
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | System architecture — graph pipeline, state fields, integrations, storage, auth — with Mermaid diagrams |
| [ROADMAP.md](ROADMAP.md) | Phase-by-phase feature roadmap with completion status |
| [adr/0001-prompt-injection-guardrails.md](adr/0001-prompt-injection-guardrails.md) | ADR: prompt injection defence — bracket-marker envelope and length caps |
| [design/UI_GUIDELINES.md](design/UI_GUIDELINES.md) | UI design guidelines — layout, components, responsive behaviour |
| [design/UI_EXAMPLES.md](design/UI_EXAMPLES.md) | UI copy examples and interaction patterns |
| [maintenance.md](maintenance.md) | Dependency versions, upgrade notes, and periodic maintenance tasks |

## Where to start

- **New to the codebase?** Read [ARCHITECTURE.md](architecture/ARCHITECTURE.md) first — it covers the full graph pipeline, state, storage, and auth with Mermaid diagrams. Then check [ROADMAP.md](ROADMAP.md) to see where the project stands.
- **Changing the UI?** Consult [UI_GUIDELINES.md](design/UI_GUIDELINES.md) before writing new components.
- **Security or prompt design?** See [ADR 0001](adr/0001-prompt-injection-guardrails.md) for the injection defence rationale.
- **Planning a new feature?** Check [ROADMAP.md](ROADMAP.md) for phase status and open steps before starting.

## Internal tooling

These files are used by AI coding agents working in this repo — not required reading for human contributors.

| Path | What it covers |
|------|----------------|
| [agents/domain.md](agents/domain.md) | Domain knowledge for AI coding agents |
| [agents/issue-tracker.md](agents/issue-tracker.md) | Issue tracking conventions |
| [agents/triage-labels.md](agents/triage-labels.md) | Triage label definitions |

## Historical planning docs

Implementation plans and design specs from earlier development phases. Kept for reference — not actively maintained.

| Path | What it covers |
|------|----------------|
| [architecture/2026-05-29-eval-architecture.md](architecture/2026-05-29-eval-architecture.md) | Evaluation layer design — three-tier scoring, LLM-as-judge, feedback loop |
| [architecture/2026-05-30-phase8-implementation-plan.md](architecture/2026-05-30-phase8-implementation-plan.md) | Phase 8 implementation plan (eval & quality observability) |
| [architecture/2026-06-03-auto-update-plan.md](architecture/2026-06-03-auto-update-plan.md) | Auto-update plan — Tauri updater integration and release pipeline |
| [superpowers/plans/2026-04-30-ui-redesign.md](superpowers/plans/2026-04-30-ui-redesign.md) | UI redesign plan (Phase 3 era) |
| [superpowers/specs/2026-04-30-tauri-scaffold-design.md](superpowers/specs/2026-04-30-tauri-scaffold-design.md) | Tauri desktop scaffold design spec |
| [superpowers/specs/2026-05-12-llm-musicbrainz-query-design.md](superpowers/specs/2026-05-12-llm-musicbrainz-query-design.md) | LLM + MusicBrainz query design spec |
