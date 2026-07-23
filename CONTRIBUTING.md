# Contributing

Thanks for contributing to Bandsearch.

## Workflow

1. Create a branch from `staging` (not `main` — PRs must target `staging`; `main` only updates by merging `staging` in after validation, and this is enforced by CI).
2. Keep changes scoped to one phase or concern.
3. Run checks locally before committing (the same checks also run automatically via a husky pre-commit hook):
   - `npm run ci` — lint + typecheck + test in one command
   - `npm run test:e2e` — Playwright end-to-end smoke tests, if you touched user-facing flows
4. Open a pull request against `staging` with:
   - clear summary
   - test evidence
   - follow-up tasks (if any)

## Commit style

- Use concise, action-oriented commit messages.
- Keep commits focused and reviewable.

## Project conventions

- Keep secrets out of git.
- Keep API keys server-side only.
- Follow the schemas in `shared/schemas`.
