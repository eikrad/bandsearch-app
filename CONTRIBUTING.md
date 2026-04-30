# Contributing

Thanks for contributing to Bandsearch.

## Workflow

1. Create a branch from `main`.
2. Keep changes scoped to one phase or concern.
3. Run CI checks locally:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test`
4. Open a pull request with:
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
