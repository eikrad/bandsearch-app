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

### Design specs

`docs/design/UI_GUIDELINES.md` and `docs/design/UI_EXAMPLES.md` are binding for
any UI change. Read them before touching a view, and follow the values marked
`(locked)` exactly rather than re-deriving them.

Two rules that exist because both were broken at once (see the card action row,
fixed 2026-08-30 — the spec was written 15 minutes *before* the code that
contradicted it, and stayed contradicted for four months):

- **Changing the design means changing the spec in the same PR.** If the
  implementation should differ from the spec, update the spec — never leave the
  two disagreeing. A code change that silently deviates is a bug even when the
  new behaviour is better.
- **Tests assert the spec, not the implementation.** A test written to match
  whatever the code happens to do will lock a spec violation in place and defend
  it against correction. That is worse than having no test.

If a spec rule is prose rather than a number, it will be interpreted and
therefore eventually ignored — when you rely on such a rule, pin it to a
concrete value and mark it `(locked)`.

### TypeScript

Application, test, and JS-toolchain config code is TypeScript only (`strict` + `noImplicitAny`). Do not add new `.js` / `.mjs` sources.

### Readme

 Keep the Readme file updated

## Git & PR Workflow

**Sequentiell arbeiten, nicht parallel.**

### Branching workflow

```
feature branch  →  staging  →  main
```

- All PRs target `staging`, never `main` directly
- `main` is only updated by merging `staging` → `main` after validation
- When creating a feature branch or fixing a bug, set `base = staging` in the PR
- `staging` acts as the integration/QA gate before production (`main`)

## Testing

TDD-Ansatz: erst Tests schreiben (rot), dann implementieren (grün), dann refactoren.

`npm test` muss vor jedem Commit grün sein.

## Commits

- Refactor vor dem Commit
- Beschreibende Commit-Messages auf Englisch
- Nach jeder abgeschlossenen Phase committen
- Erledigte Punkte in `docs/ROADMAP.md` als `✓ Done` markieren