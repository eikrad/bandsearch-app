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

Android (Phase 11, see `docs/superpowers/plans/2026-08-30-android.md`) rides the
same pipeline once built — no separate release cycle:

- Same workflow run, same `vX.Y.Z` tag: the signed APK is another artifact
  alongside the Linux/Windows/macOS installers, not a second process.
- A failing Android build keeps the whole release a draft, desktop included.
  That is deliberate — all platforms ship the same version or none does — but
  it means an Android toolchain problem (NDK, signing) also holds back desktop
  fixes until it is solved.
- `versionCode` is Tauri's default, derived from the version in
  `tauri.conf.json` (`major*1000000 + minor*1000 + patch`); never hand-set.
- Test builds (`v0.4.1-test`) are never published to the F-Droid repo: they
  share the real release's `versionCode`, so a tester who installed one would
  never be offered the real `v0.4.1`.
- The F-Droid repo index entry reuses this release's `CHANGELOG.md` section
  as its changelog, and the README's opening line as the short description —
  no separate metadata file to update per release.
- There is no in-app updater on Android (`tauri-plugin-updater` doesn't
  support it); the F-Droid client on the tester's device handles update
  notifications once the new index is published.

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

| Commit                                                      | Next version          |
| ----------------------------------------------------------- | --------------------- |
| `fix: …`                                                    | 0.4.0 → 0.4.1         |
| `feat: …`                                                   | 0.4.0 → 0.4.1         |
| `feat!: …` or a `BREAKING CHANGE:` footer                   | 0.4.0 → 0.5.0         |
| `docs`, `chore`, `build`, `ci`, `test`, `refactor`, `style` | no release on its own |

`feat`, `fix`, `perf`, `security` and `revert` appear in the CHANGELOG; the other types are
hidden. From 1.0 on, `feat` bumps the minor and a breaking change the major version.

The **Commit messages** check fails a pull request with a commit that lacks a prefix,
since release-please would silently leave that commit out.

## How to merge pull requests

release-please reads every commit on `main`, merge commits included, and treats each line
in a commit body that looks like a Conventional Commit as a change of its own. A GitHub
merge commit carries the pull request's title in its body, so a feature PR titled
`feat(desktop): …` merged with a merge commit lands in the CHANGELOG twice: once from the
commit itself, once from the merge commit. If the `staging` → `main` PR carries the same
line in its body, it lands a third time. This is why 0.4.1 lists most entries twice.

| Pull request                                  | Merge with            | Title                                  |
| --------------------------------------------- | --------------------- | -------------------------------------- |
| feature branch → `staging`                    | **Rebase and merge**  | anything; it never reaches the history |
| `staging` → `main`                            | Create a merge commit | `chore: merge staging into main`       |
| release-please's `chore(main): release X.Y.Z` | Create a merge commit | unchanged                              |
| back-merge `main` → `staging`                 | Create a merge commit | unchanged (`chore: …`)                 |

- **Rebase, not squash, for feature PRs.** Rebase puts each commit on `staging` unchanged
  and adds no merge commit, so every change appears once and the per-phase commits stay
  in the history. Squash would also avoid the duplicates, but collapses a PR into one
  commit and one CHANGELOG line.
- **Never rebase or squash `staging` → `main`.** Either rewrites the commits, so `main`
  and `staging` stop sharing history and every later release conflicts.
- **`chore:` titles for the merges into and out of `main`.** `chore` is hidden in the
  CHANGELOG, so the merge commit adds no entry. A plain title such as "Release" works
  too; a `feat:` or `fix:` title does not.

One-time setup: repository **Settings** → General → Pull Requests → enable **Allow rebase
merging**, and keep **Allow merge commits** enabled for the `staging` → `main` merges.

## One-time setup: the release token

Pull requests opened with the workflow's own `GITHUB_TOKEN` do not trigger other
workflows, so CI would never run on the release PR. The workflow therefore uses a token
stored as the `RELEASE_PLEASE_TOKEN` secret:

1. Open [the new fine-grained token page](https://github.com/settings/personal-access-tokens/new)
   (or [your fine-grained tokens](https://github.com/settings/personal-access-tokens) →
   Generate new token). (By hand: your profile
   picture, top right → **Settings** → **Developer settings**, at the bottom of the left
   sidebar → Personal access tokens → **Fine-grained tokens** → Generate new token. These
   are your *account* settings; the repository's Settings tab has no Developer settings.)
2. Repository access: **Only select repositories** → this repository. One token can cover
   several repositories: select each one that uses release-please and store the same token
   in each of them.
3. Permissions → Repository permissions: **Contents: Read and write**, **Pull requests: Read
   and write** (Metadata: Read-only is added automatically).
4. Choose an expiry and put a reminder in your calendar; the release workflow fails once
   it has expired.
5. In this repository (its **Settings** tab) → Secrets and variables → Actions → New repository secret,
   name `RELEASE_PLEASE_TOKEN`, value the token.

The existing `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets
are passed on to the build unchanged.

## Changing the next version by hand

Set `"release-as": "1.0.0"` for the `"."` package in `release-please-config.json`, merge it
to `main`, and remove the line again after the release.
