# Agent instructions

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for this repository using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles use the default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Roadmap

When working on Roadmap items update Roadmap corresponfingly.

### TypeScript migration policy

Implement TypeScript as a parallel, non-blocking track: migrate incrementally in files touched by current tasks; do not pause feature work for large rewrites.

### Readme

 Keep the Readme file updated

## Git & PR Workflow

**Sequentiell arbeiten, nicht parallel.**

## Testing

TDD-Ansatz: erst Tests schreiben (rot), dann implementieren (grün), dann refactoren.

`npm test` muss vor jedem Commit grün sein.

## Commits

- Refactor vor dem Commit
- Beschreibende Commit-Messages auf Englisch
- Nach jeder abgeschlossenen Phase committen
- Erledigte Punkte in `docs/ROADMAP.md` als `✓ Done` markieren