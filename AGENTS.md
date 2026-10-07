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
- Feature PRs are merged with **Rebase and merge**; `staging` → `main` with a merge commit
  and a `chore:` title. Otherwise the CHANGELOG lists changes twice (`docs/releasing.md`)

**An issue is done when its work reaches `main`.** GitHub honours `Closes #123`
only on the *default* branch, `main`, so the keyword in a PR into `staging` never
fires. A keyword in a **commit message** does: the merge `staging` → `main` brings
the commit onto `main`, and GitHub closes the issue then. So:

- Put `Closes #123` in the message of the commit that finishes the issue (and in
  the PR description, which records the link). `Refs #123` for partial work.
- Do not close issues by hand when a PR merges into `staging`; work sitting in
  `staging` is not shipped yet.
- If a finished issue has no closing commit, list `Closes #123` in the
  `staging` → `main` PR description instead.

## Testing

TDD-Ansatz: erst Tests schreiben (rot), dann implementieren (grün), dann refactoren.

`npm test` muss vor jedem Commit grün sein.

## Commits

- Refactor vor dem Commit
- Beschreibende Commit-Messages auf Englisch, als Conventional Commits (`feat:`, `fix:`, `feat!:`, `docs:`, `chore:` …); daraus entstehen Version und CHANGELOG (`docs/releasing.md`). Versionsnummern nie von Hand ändern
- Nach jeder abgeschlossenen Phase committen
- Erledigte Punkte in `docs/ROADMAP.md` als `✓ Done` markieren
