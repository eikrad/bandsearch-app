# Documentation

Navigation guide for the `docs/` folder.

## Core docs

| Path | What it covers |
|------|----------------|
| [ROADMAP.md](ROADMAP.md) | Feature roadmap with phase completion status |
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | System architecture — graph pipeline, state fields, integrations, storage, auth |
| [adr/0001-prompt-injection-guardrails.md](adr/0001-prompt-injection-guardrails.md) | ADR: prompt injection defence — bracket-marker envelope and length caps |
| [design/UI_GUIDELINES.md](design/UI_GUIDELINES.md) | UI design guidelines — layout, components, responsive behaviour |
| [design/UI_EXAMPLES.md](design/UI_EXAMPLES.md) | UI copy examples and interaction patterns |

## AI agent guides

Resources for AI coding agents (Claude Code, Cursor, Codex, etc.) working in this repo.

| Path | What it covers |
|------|----------------|
| [agents/domain.md](agents/domain.md) | Domain knowledge for AI coding agents working in this repo |
| [agents/issue-tracker.md](agents/issue-tracker.md) | Issue tracking conventions |
| [agents/triage-labels.md](agents/triage-labels.md) | Triage label definitions |

## Where to start

- **New to the codebase?** Read [ARCHITECTURE.md](architecture/ARCHITECTURE.md) first, then [ROADMAP.md](ROADMAP.md) to see where the project stands.
- **Changing the UI?** Consult [UI_GUIDELINES.md](design/UI_GUIDELINES.md) before writing new components.
- **Security or prompt design?** See [ADR 0001](adr/0001-prompt-injection-guardrails.md) for the injection defence rationale.
- **Planning a new feature?** Check [ROADMAP.md](ROADMAP.md) for phase status and open steps before starting.

## Design records

Implementation notes for shipped features — useful context for understanding *why* things are built the way they are. Not actively updated.

| Path | What it covers |
|------|----------------|
| [architecture/2026-05-29-eval-architecture.md](architecture/2026-05-29-eval-architecture.md) | Evaluation layer design — three-tier scoring, LLM-as-judge, feedback loop |
| [architecture/2026-05-30-phase8-implementation-plan.md](architecture/2026-05-30-phase8-implementation-plan.md) | Phase 8 implementation plan — eval & quality observability |
| [architecture/2026-06-03-auto-update-plan.md](architecture/2026-06-03-auto-update-plan.md) | Auto-update plan — Tauri updater integration and release pipeline |
| [superpowers/plans/2026-04-30-ui-redesign.md](superpowers/plans/2026-04-30-ui-redesign.md) | UI redesign plan (Phase 3 era) |
| [superpowers/specs/2026-04-30-tauri-scaffold-design.md](superpowers/specs/2026-04-30-tauri-scaffold-design.md) | Tauri desktop scaffold design spec |
| [superpowers/specs/2026-05-12-llm-musicbrainz-query-design.md](superpowers/specs/2026-05-12-llm-musicbrainz-query-design.md) | LLM + MusicBrainz query design spec |
