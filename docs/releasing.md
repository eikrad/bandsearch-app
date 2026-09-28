# Releasing

Versions, the CHANGELOG and the desktop release are produced by
[release-please](https://github.com/googleapis/release-please) from Conventional Commit
messages. Nobody edits version numbers by hand.

## How a release happens

1. Changes reach `main` the usual way: feature branch → `staging` → `main`.
2. On every push to `main`, the **Release** workflow (`.github/workflows/release-please.yml`)
   opens or updates a pull request titled `chore(main): release X.Y.Z`. It bumps the
   version in every `package.json`, `apps/desktop/src-tauri/tauri.conf.json`,
   `apps/desktop/src-tauri/Cargo.toml` and `pyproject.toml`, syncs `package-lock.json`,
   `Cargo.lock` and `uv.lock`, and adds the `CHANGELOG.md` entry.
3. When you want to release, merge that pull request. Then, automatically:
   1. release-please tags `vX.Y.Z` and creates a **draft** GitHub release with the notes.
   2. **Build desktop installers** (`.github/workflows/release.yml`) builds Linux, Windows
      and macOS, and uploads the installers, their signatures and `latest.json` into
      that draft.
   3. Once every build has passed, the release is published and marked **latest**. Only
      now does the in-app updater
      (`releases/latest/download/latest.json`) offer it to users.
   4. A pull request merging `main` back into `staging` is opened. Merge it too.

If a build fails, the release stays a draft and no user sees it. Fix the problem, then
either re-run the failed jobs or delete the draft and its tag and release again.

Until you merge the release PR, it keeps collecting whatever lands on `main`.

## Test builds

Actions → **Build desktop installers** → Run workflow, with a tag such as `v0.4.1-test`,
builds into a new draft pre-release, as pushing a `v*` tag used to. Pushing a tag no
longer starts a build.

## Which version comes next

Before 1.0 (`bump-minor-pre-major` and `bump-patch-for-minor-pre-major` in
`release-please-config.json`):

| Commit | Next version |
|---|---|
| `fix: …` | 0.4.0 → 0.4.1 |
| `feat: …` | 0.4.0 → 0.4.1 |
| `feat!: …` or a `BREAKING CHANGE:` footer | 0.4.0 → 0.5.0 |
| `docs`, `chore`, `build`, `ci`, `test`, `refactor`, `style` | no release on its own |

`feat`, `fix`, `perf`, `security` and `revert` appear in the CHANGELOG; the other types are
hidden. From 1.0 on, `feat` bumps the minor and a breaking change the major version.

The **Commit messages** check fails a pull request with a commit that lacks a prefix,
since release-please would silently leave that commit out.

## One-time setup: the release token

Pull requests opened with the workflow's own `GITHUB_TOKEN` do not trigger other
workflows, so CI would never run on the release PR. The workflow therefore uses a token
stored as the `RELEASE_PLEASE_TOKEN` secret:

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
   → Generate new token.
2. Repository access: **Only select repositories** → this repository.
3. Permissions: **Contents: Read and write**, **Pull requests: Read and write**.
4. Choose an expiry and set a reminder; the release workflow fails once it has expired.
5. In this repository: Settings → Secrets and variables → Actions → New repository secret,
   name `RELEASE_PLEASE_TOKEN`, value the token.

The existing `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets
are passed on to the build unchanged.

## Changing the next version by hand

Set `"release-as": "1.0.0"` for the `"."` package in `release-please-config.json`, merge it
to `main`, and remove the line again after the release.
