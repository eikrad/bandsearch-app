# Task 7 Report: API tests — core routes & auth

**Status:** Done. Converted only the 16 suites listed in the brief and updated the API TypeScript include.

**Commit:** `926cb3a test(api): convert core route and auth tests to TypeScript`

## What changed

- Renamed the listed `services/api/test/*.test.js` files to `.test.ts` with Git history preserved.
- Replaced CommonJS imports with ESM imports and NodeNext `.js` extensions.
- Added durable types for request helpers and doubles, narrowed JSON from `unknown`, and used real `Response` objects for fetch doubles.
- Updated `services/api/tsconfig.json` to include `src/**/*.ts`, `scripts/**/*.ts`, and `test/**/*.ts`; removed obsolete `src/**/*.js`.
- Left Task 8 preference/Turso/research/eval tests unchanged.

## Verification

```text
npm test --workspace @bandsearch/api
423 tests, 423 passed, 0 failed

npm run typecheck --workspace @bandsearch/api
exit 0, no diagnostics

npm run lint --workspace @bandsearch/api
exit 0, no findings
```

The pre-commit hook also completed successfully before the commit was created.

## Concerns

- None. The unrelated untracked `docs/superpowers/plans/2026-06-13-stop-retry-buttons.md` was left untouched.

## Review fix: property-level JSON narrowing

- Removed broad `ApiData` assertions from all eight Task 7 core suites that parse HTTP JSON: artist image, artist search, auth, chat sessions, end-to-end smoke, groups, recommendations, and system routes.
- Kept response JSON as `unknown`, narrowed the outer object to `Record<string, unknown>`, and validated nested records, arrays, strings, and group objects at their use sites.
- Left Task 8 preference, research, and eval JavaScript suites unchanged.

### Verification

```text
npm test --workspace @bandsearch/api
423 tests, 423 passed, 0 failed

npm run typecheck --workspace @bandsearch/api
exit 0, no diagnostics
```
