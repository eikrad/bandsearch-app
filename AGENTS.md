# Agent instructions

## Agent skills
Use /feature-worklfow when useful
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

- **Changing the design means changing the spec in the same PR.** If the
  implementation should differ from the spec, update the spec — never leave the
  two disagreeing. A code change that silently deviates is a bug even when the
  new behaviour is better.
- **A spec written ahead of the code must say so.** Designing before building is
  fine and often right, but the document must then mark the part that is not
  built yet and link the issue tracking it. Otherwise the spec asserts behaviour
  the product does not have, and the next reader — human or agent — takes it as
  description rather than intent. This bit twice on 2026-08-30: the card action
  row and ADR 0002 both stated future behaviour in the present tense, and
  `CONTEXT.md` repeated one of them as fact.
- **Tests assert the spec, not the implementation.** A test written to match
  whatever the code happens to do will lock a spec violation in place and defend
  it against correction. That is worse than having no test.


### TypeScript

Application, test, and JS-toolchain config code is TypeScript only (`strict` + `noImplicitAny`). Do not add new `.js` / `.mjs` sources.

### Readme

 Keep the Readme file updated

## Git & PR Workflow

**Work sequential not parrallel.**

### Branching workflow

```
feature branch  →  staging  →  main
```

- All PRs target `staging`, never `main` directly
- `main` is only updated by merging `staging` → `main` after validation
- When creating a feature branch or fixing a bug, set `base = staging` in the PR
- `staging` acts as the integration/QA gate before production (`main`)

**Issues do not close themselves here.** GitHub honours `Closes #123` only when a
PR merges into the *default* branch — `main`. Since PRs target `staging`, the
keyword never fires, and a finished issue stays open until someone closes it by
hand. Still write `Closes #123` in the PR so the link is recorded, then close the
issue manually once the PR is merged.

## Testing

TDD-Ansatz: erst Tests schreiben (rot), dann implementieren (grün), dann refactoren.

`npm test` muss vor jedem Commit grün sein.

## Commits

- Refactor vor dem Commit
- Beschreibende Commit-Messages auf Englisch
- Nach jeder abgeschlossenen Phase committen
- Erledigte Punkte in `docs/ROADMAP.md` als `✓ Done` markieren
