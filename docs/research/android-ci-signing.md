# Research: building and signing an Android APK in GitHub Actions

Issue #317 (map #314; feeds #323). Researched 2026-11-19 on branch
`research/android-ci-signing`. Throwaway evidence branch: never merged.

**Scope.** Facts and a recommendation only. No workflow or application code was
changed. Each claim gives a source and a confidence level: **High** means read in
primary source code or official docs, **Medium** means inferred from primary
sources but not run, and **UNKNOWN** means it could not be verified without a real
build (spike #319).

**Versions this is pinned to:**

- `@tauri-apps/cli` **2.12.6**, from `package-lock.json` (`node_modules/@tauri-apps/cli`).
- `tauri` 2.12.7, `tauri-build` 2.7.6 and `tauri-utils` 2.10.4, from
  `apps/desktop/src-tauri/Cargo.lock:3690-3928`.
- The source was read at tag `tauri-cli-v2.12.6` of `tauri-apps/tauri`,
  `tauri-apps/tauri-action@v1` (commit `1deb371`, 2026-06-29), and
  `cargo-mobile2` 0.22.5 (the version tauri-cli 2.12.6 locks).

---

## 1. Does `tauri-action` build Android?

**Answer: yes, as an experimental option.** It only runs `tauri android build`.
You must install the JDK, SDK, NDK and Rust target yourself, and set up signing yourself.

- The `mobile: android` input turns `tauri build` into `tauri android build`
  (`tauri-action/src/build.ts:42`). README: *"EXPERIMENTAL … you have to install
  system dependencies (Xcode, SDKs, etc) yourself"*, and *"The action's iOS and
  Android support is considered experimental"* (`README.md:243-259, 301`). The
  CHANGELOG says: *"Added initial Android & iOS support. This only includes
  building … installing dependencies and uploading to stores must be done
  manually."* **High.**
- **It uploads whichever APK it finds, signed or not.** It lists both
  `app-<abi>-release-unsigned.apk` and `app-<abi>-release.apk`, then keeps the
  ones that exist (`build.ts:330-425, 517`, with the comment
  `// TODO: detect (un)signed beforehand`). If signing is misconfigured, it uploads
  an **unsigned** APK into the draft without failing. **High.** Consequence: the job
  needs its own `apksigner verify` step (§5).
- **Asset name.** Android assets are named `<productName>_<version>_<arch>.apk`
  (`utils.ts:101-135`). A non-split build always lands in the `universal/` output
  folder, even when it was built for a single ABI. A `--target aarch64` build
  without `--split-per-abi` is therefore published as `Bandsearch_X.Y.Z_universal.apk`,
  which is misleading. With `--split-per-abi --target aarch64` the output is
  `apk/arm64/release/app-arm64-release.apk`, published as `Bandsearch_X.Y.Z_arm64.apk`
  (see `cargo-mobile2/src/android/apk.rs:39-58, 72-146`). **High** from source. The
  exact file name is **Medium** until a run confirms it.
- **`latest.json`.** The action rewrites `latest.json` only from `.sig` files
  (`upload-version-json.ts:178-183`). Android produces none, so it logs
  "Signature not found … Skipping" and leaves the desktop updater manifest alone.
  **High.** Set `uploadUpdaterJson: false` anyway, so the intent is explicit.
- **Releases.** It uses the same release logic as desktop: `releaseId` when given,
  otherwise `tagName`/`releaseName` to get or create the draft (`index.ts:102-128`).
  The Android job therefore joins the release-please draft exactly like the three
  desktop jobs. **High.**

**Alternative:** run `npm run tauri -- android build …` directly, then
`gh release upload`. It gives the same result and avoids the experimental action,
but you take on the release lookup and naming yourself. Either works.

## 2. How does it join the draft and respect the "publish only when every build passed" gate?

- `release-please.yml:80-87` calls `release.yml` as a reusable workflow
  (`build`). `publish` has `needs: [release-please, build]` and no `if:`
  (`release-please.yml:89-90`), so it runs only if `build` succeeded.
  `fail-fast: false` (`release.yml:32`) lets the other platforms finish, but any
  failed job inside `release.yml` fails `build`. **High.**
- **So the plan's intent works if Android is added as a job inside `release.yml`.**
  It must be a separate job, because the steps differ from the desktop matrix.
  Do not put it in a separate workflow: then `publish` would not wait for it.
  A failing Android job leaves the release a draft and blocks desktop too, as
  `docs/releasing.md:39-42` already says. **High.**
- `secrets: inherit` (`release-please.yml:87`) already forwards new repository
  secrets to `release.yml`, so no change is needed there. **High.**
- Manual runs (`workflow_dispatch`, no `release_id`): all four jobs call
  `getOrCreateRelease(tagName)`. This is the existing desktop behaviour, unchanged.
  **High.**

## 3. Runner prerequisites and versions to pin

What Tauri 2.12.6's generated Android project requires (template
`crates/tauri-cli/templates/mobile/android/`):

| Item | Value in template | Source | Confidence |
| --- | --- | --- | --- |
| Android Gradle Plugin | 9.3.1 | `build.gradle.kts`, `buildSrc/build.gradle.kts` | High |
| Gradle wrapper | 9.6.1 | `gradle/wrapper/gradle-wrapper.properties` | High |
| Kotlin Gradle plugin | 2.2.10 | `build.gradle.kts` | High |
| compileSdk / targetSdk | 37 / 37 | `app/build.gradle.kts:20,26` | High |
| Default minSdk | 24 (we set 29) | `tauri-utils/src/config.rs`; [Tauri Google Play docs](https://v2.tauri.app/distribute/google-play/) | High |
| NDK Tauri installs itself if none is found | `29.0.13846066` | `tauri-cli/src/mobile/android/mod.rs:53` | High |
| SDK platform Tauri installs | `android-37` | `mod.rs:54` | High |

- **JDK: minimum 17** for AGP 9.3 ([AGP 9.3 release notes](https://developer.android.com/build/releases/agp-9-3-0-release-notes),
  compatibility table: JDK minimum 17, default 17). Gradle 9.6 runs on Java up to
  26, according to Tauri's own check (`check_java_gradle_versions.rs`). The Tauri
  2.12 blog says the template now allows *"the latest Java (v25)"*. **Pin
  Temurin 21 with `actions/setup-java` (v6.3.0 is current).** That keeps the build
  independent of the runner default, which is 17 on Ubuntu 24.04 and **25 on
  26.04** (runner-images READMEs, image 20261111). **High** for the facts, Medium
  for the choice.
- **Build-tools.** AGP 9.3 needs SDK Build Tools 36.0.0 or newer (same release
  notes). The runner has 34–37. `apksigner` and `zipalign` come from build-tools.
  **High.**
- **NDK: pin it explicitly through `NDK_HOME`.** This is the finding with the most
  consequence:
  - Tauri reads **`NDK_HOME`**, not `ANDROID_NDK_HOME`. When it is unset, Tauri
    sorts `$ANDROID_HOME/ndk/*` and takes the **last** entry (`mod.rs:716-741`).
    **High.**
  - The ubuntu-24.04 and 26.04 images ship NDK `27.3.13750724` (the default, and the
    target of `ANDROID_NDK_HOME`), `29.0.14206865` and `30.0.16248370`. Unpinned,
    CI builds with **r30 today**, and switches silently when the image changes.
    **High.**
  - Do **not** copy the common `NDK_HOME: ${{ env.ANDROID_NDK_HOME }}` idiom: it
    selects **r27**. The [16 KB page-size guide](https://developer.android.com/guide/practices/page-sizes)
    says *"NDK version r28 and higher compile 16 KB-aligned by default"*, and that
    r27 needs extra linker flags. Without them, the app runs in "page size compat
    mode" on 16 KB devices, or crashes because of RELRO. **High** for the docs.
    Whether Rust linking through the NDK clang inherits the r28 default is
    **Medium**, so the CI check in §5 confirms it.
  - Recommendation: install exactly `ndk;29.0.13846066`, the version Tauri's
    developer auto-install uses, with
    `$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager`, and set `NDK_HOME` to it.
    A developer machine and CI then use the same NDK, and runner-image churn cannot
    move it. The alternative is the preinstalled `29.0.14206865`, which avoids the
    download but disappears when the image drops it. **Medium** (the
    `cmdline-tools/latest` path is the runner convention, not run here).
- **Rust target:** add `aarch64-linux-android` with `dtolnay/rust-toolchain`'s
  `targets:` input. The CLI installs missing targets itself (`build.rs:200-210`),
  but stating the target explicitly makes it visible. The [Tauri prerequisites
  page](https://v2.tauri.app/start/prerequisites/) lists all four Android triples.
  **High.**
- **`--ci`:** clap reads it from the `CI` environment variable (`build.rs`, `#[clap(long, env = "CI")]`),
  which GitHub sets to `true`. Non-interactive mode makes a missing SDK or NDK a
  hard error instead of a prompt (`mod.rs:629-633, 742-745`). **High.**
- **`ubuntu-latest` moves to 26.04 in November 2026** (runner-images announcement).
  This also affects the existing desktop Linux job. Pinning `ubuntu-24.04` for the
  Android job avoids a surprise mid-release. **High** for the fact.

## 4. ABIs: arm64-only or universal

**Facts:**

- `tauri android build` with no flags builds **APK and AAB for all four ABIs**
  (`build.rs:254-258, 284-310`, and `get_targets_or_all`). Pass `--apk` and
  `--target …` to avoid doing four times the work. **High.**
- [Android ABI guide](https://developer.android.com/ndk/guides/abis): a fat APK is
  *"significantly larger than one containing only the binaries for a single ABI"*,
  and the package manager extracts only the matching ABI at install time. A device
  with no matching `.so` *"builds and installs, but crashes at runtime"*. **High.**
- **UNKNOWN:** the APK size for this app per ABI, and the share of Android 10+
  devices that are 32-bit-only (armeabi-v7a). Android's docs publish no ABI share
  figures, and I found no primary source for them. Size comes from spike #319.

**Recommendation: arm64-only** (`--apk --split-per-abi --target aarch64`).

- The testers are an invited closed beta with known phones, including the Android
  10+ test phone. A tester on a 32-bit-only phone can be detected by asking, not
  guessed by statistics.
- One build, a single compilation of a heavy release profile (`lto = true`,
  `codegen-units = 1`), and the smallest APK.
- The asset name (`Bandsearch_X.Y.Z_arm64.apk`) says what the file is.
- **Adding armv7 later** means one more `--target armv7`, which yields a second
  `_arm.apk`. Both share one versionCode, because Tauri does not offset it per ABI
  (`mod.rs:1148-1191`). That is fine for sideloading. It matters only for a future
  F-Droid repository (#158). x86_64 is only needed for an emulator, and nothing
  runs one in CI.

## 5. Signing

**How the keystore reaches Gradle.** The [official Tauri Android signing guide](https://v2.tauri.app/distribute/sign/android/)
has two parts:

1. Edit `src-tauri/gen/android/app/build.gradle.kts` once. Add `signingConfigs { create("release") { … } }`,
   which reads `rootProject.file("keystore.properties")`, and set
   `buildTypes.release.signingConfig = signingConfigs.getByName("release")`.
2. In CI, write `gen/android/keystore.properties` (`keyAlias`, `password`,
   `storeFile`) and decode the keystore with `base64 -d` into `$RUNNER_TEMP`. The
   guide shows this exact GitHub Actions step.

**High.**

Consequences:

- **`gen/android/` must be committed.** The signing edit lives inside it, and the
  CLI refuses to build an uninitialised project (`ensure_init`). The template's own
  `.gitignore` already excludes `keystore.properties`, `key.properties`,
  `local.properties`, `tauri.properties` and build output
  (`templates/mobile/android/.gitignore`, `app/.gitignore`). This repo already
  commits `src-tauri/gen/schemas/`. **Medium:** no Tauri page says "commit
  gen/android" in so many words, but it follows from the above.
- **One password, not two.** The Tauri snippet uses a single `password` for both
  `keyPassword` and `storePassword`. Android Studio says the key password *"should
  be the same as your keystore password"*
  ([app signing](https://developer.android.com/studio/publish/app-signing)). keytool's
  default keystore type since JDK 9 is PKCS12, and *"most third-party tools require
  `storepass` and `keypass` in a PKCS #12 keystore to be the same"*
  ([keytool man page](https://docs.oracle.com/en/java/javase/21/docs/specs/man/keytool.html)).
  The plan's four secrets (`ANDROID_KEY_PASSWORD` **and** `ANDROID_STORE_PASSWORD`)
  therefore become three: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS` and
  `ANDROID_KEYSTORE_PASSWORD`. **High.**
- **keytool's default `-validity` is 90 days** (keytool man page). Android
  recommends 25 years or more, and an expired certificate stops seamless upgrades
  (app-signing page). Tauri's documented command passes `-validity 10000`
  (≈27 years). The key-generation step must pass it explicitly. **High.**
- GitHub secrets are limited to **48 KB** ([docs](https://docs.github.com/en/actions/reference/security/secrets)).
  A base64 RSA-2048 keystore is a few KB. **High.**

**APK, not only AAB:** `--apk` builds the APK, and Gradle signs it with the release
signingConfig. No AAB is needed: the AAB exists for Play's re-signing, and v1 is
sideloaded. **High.**

**Which tool signs, and where `apksigner` fits:**

- With a `signingConfig`, **AGP signs the APK during `assembleRelease`**. AGP's DSL
  exposes `enableV1Signing` through `enableV4Signing`, each *"If null, a default
  value is used"* ([ApkSigningConfig](https://developer.android.com/reference/tools/gradle-api/9.0/com/android/build/api/dsl/ApkSigningConfig)).
  The defaults themselves are **UNKNOWN** from the docs.
- `apksigner` (build-tools) picks schemes from `--min-sdk-version`, which defaults
  to the manifest's minSdk ([apksigner](https://developer.android.com/tools/apksigner)).
  v2 suffices for minSdk 29, and v3 adds key-rotation capability.
- **Use `apksigner` to verify, not to sign:**
  `apksigner verify --verbose --print-certs app.apk`, then compare the SHA-256
  certificate digest with a committed fingerprint, plus `zipalign -c -P 16 -v 4`
  (the 16 KB check from the page-size guide). This catches three failures:
  - an unsigned APK uploaded silently (§1),
  - the wrong keystore,
  - a 4 KB-aligned `.so`.
- If you ever sign manually instead, zipalign must run **before** apksigner
  (apksigner docs). **High.**

## 6. What is fixed forever once an APK is signed and installed

| Thing | Why it is permanent | Source |
| --- | --- | --- |
| **`applicationId` = `app.bandsearch`** | Tauri writes `identifier` straight into `namespace` and `applicationId` (`templates/mobile/android/app/build.gradle.kts:21,24`). A different ID is a different app: no upgrade path, and user data is not carried over. *"Once you publish your app, you should never change the application ID."* | [configure-app-module](https://developer.android.com/build/configure-app-module) |
| **Signing certificate (the keystore key)** | *"The system allows the update if the certificates match. If you sign the new version with a different certificate, you must assign a different package name."* Losing it means *"you will not be able to publish updates."* Rotation exists (APK Signature Scheme v3 lineage, `apksigner rotate`), but it needs the old key too, so it does not rescue a lost key. | [app-signing](https://developer.android.com/studio/publish/app-signing), [apksigner](https://developer.android.com/tools/apksigner) |
| **Certificate validity end date** | Set at generation. After expiry, *"users will no longer be able to seamlessly upgrade."* | app-signing |
| **versionCode only goes up** | *"preventing users from installing an APK with a lower `versionCode` than the version currently installed."* So the formula must never change in a way that lowers the number. | [versioning](https://developer.android.com/studio/publish/versioning) |

`identifier` also sets the Kotlin package path in `gen/android`. Changing it later
means regenerating the project. `app.bandsearch` satisfies the naming rules: at
least 2 segments, each starting with a letter, `[a-zA-Z0-9_]`. **High.**

Not fixed: `minSdkVersion`, `targetSdk`, ABIs, app name, icon and permissions can
all change between releases.

## 7. Plan's versionCode formula, checked against source

`tauri-cli/src/mobile/android/mod.rs:1148-1191` (`generate_tauri_properties`):

```rust
} else if let Ok(version) = Version::parse(version) {
  let mut version_code = version.major * 1000000 + version.minor * 1000 + version.patch;
  ...
  } else if version_code > 2100000000 { bail!(...) }
```

The value is written to `gen/android/app/tauri.properties`, which `build.gradle.kts:27`
reads. Precedence is `autoIncrementVersionCode` (off by default), then
`bundle.android.versionCode`, then the semver formula.

- **The formula in the plan and `docs/releasing.md:43-44` is correct.** `0.4.5` →
  `4005`. **High.**
- Limits: a patch ≥ 1000 collides with the next minor. A major above 2099 bails.
  Neither is realistic.
- **The input is `tauri.conf.json` → `version`, not the git tag.**
  - Semver pre-release suffixes are ignored by the formula (`0.5.0-rc.1` → `5000`).
  - This makes the plan's test-build statement **inaccurate.** `docs/releasing.md:45-47`
    and plan lines 179-182 say a `v0.4.1-test` build *"share[s] the real release's
    `versionCode`"*. In fact a manual test build checks out the test tag
    (`release.yml:42-44`) and gets whatever `version` that commit's
    `tauri.conf.json` holds.
  - release-please bumps that only in the release PR, so a test tag on a normal
    commit carries the **previous** release's version. For example, `v0.4.1-test`
    cut after 0.4.0 → `4000`, the same as the *installed* 0.4.0, not the future
    0.4.1.
  - The real 0.4.1 (`4001`) still upgrades over it. The actual hazard is different:
    two different APKs with the same versionCode and versionName `0.4.0`. A
    tester's phone, or Obtainium, cannot tell them apart.
  - The rule "test builds never go where testers update from" stands. The reason
    given needs correcting.

## 8. Build time and runner cost

- **Cost: $0.** *"Standard GitHub-hosted runners in public repositories"* are free
  ([billing docs](https://docs.github.com/en/billing/concepts/product-billing/github-actions)),
  and the repo is public (`gh repo view`). **High.**
- **Desktop baseline, measured:** release run 43908032997 (v0.4.5, 2026-11-16) took
  ubuntu 6m11s, windows 6m25s and macOS 6m00s, with no Rust cache. Run 40000276925:
  ubuntu 8m18s. The release takes about as long as its slowest job.
- **Android: UNKNOWN until spike #319.** It runs a release Rust build of the whole
  crate graph for one target (with LTO), plus a cold Gradle 9 / AGP 9 build, an NDK
  download (~1–2 min if installed explicitly) and frontend build. A guess is
  10–20 min. It would probably become the longest job in the release. Caching
  (`Swatinem/rust-cache` v2.9.3, and setup-java's `cache: gradle`) can come later.
- **Holding back desktop:** confirmed in §2. Recovery stays as `docs/releasing.md:55-56`
  describes: re-run the failed job, or delete the draft and tag.

---

## Recommended pipeline shape

A new job **`android`** in `.github/workflows/release.yml`, alongside the
`build` matrix:

```yaml
android:
  runs-on: ubuntu-24.04            # not -latest: it moves to 26.04 this month
  permissions: { contents: write }
  env:
    NDK_VERSION: 29.0.13846066     # = Tauri 2.12's own pin (mod.rs:53), r28+ for 16 KB
  steps:
    - checkout (ref: inputs.tag)
    - setup-node (.nvmrc, npm cache)
    - actions/setup-java@v6 { distribution: temurin, java-version: 21 }
    - dtolnay/rust-toolchain@stable { targets: aarch64-linux-android }
    - install NDK: sdkmanager "ndk;$NDK_VERSION"; echo "NDK_HOME=$ANDROID_HOME/ndk/$NDK_VERSION" >> $GITHUB_ENV
    - npm ci
    - write gen/android/keystore.properties + base64-decode keystore to $RUNNER_TEMP
      (secrets: ANDROID_KEYSTORE_BASE64, ANDROID_KEY_ALIAS, ANDROID_KEYSTORE_PASSWORD)
    - tauri-apps/tauri-action@v1:
        mobile: android
        args: --apk --split-per-abi --target aarch64
        projectPath / releaseId / tagName / releaseName / releaseDraft / prerelease: as desktop
        uploadUpdaterJson: false
    - verify: apksigner verify --print-certs (SHA-256 == committed fingerprint, fails otherwise),
              zipalign -c -P 16 -v 4, and fail if any *-unsigned.apk was produced
```

Notes:

- The verify step runs after the upload. That is acceptable: a failure fails the
  job, `build` fails, `publish` is skipped, and the bad asset stays in an
  unpublished draft.
- To verify **before** uploading, build with the CLI and upload with
  `gh release upload "$TAG" … --clobber` instead of using tauri-action.
- Prerequisites the job assumes but this ticket does not resolve:
  - `gen/android/` is committed, with the signingConfig edit.
  - `minSdkVersion: 29` goes in config.
  - The desktop-only `bundle.externalBin: binaries/node` is overridden for Android
    (see the surprises).

All three belong to #315 and #319.

## Unknowns (need the spike, #319)

1. APK size, arm64 only. Whether a 32-bit-only tester exists, which is a question
   for the owner.
2. Android job wall time, cold and cached.
3. AGP's default v1/v2/v3 scheme selection at minSdk 29. Read it from
   `apksigner verify --verbose` on the first build.
4. Whether Rust's `.so`, linked through NDK r29 clang, is 16 KB-aligned without
   extra flags. Check with `zipalign -c -P 16` or `check_elf_alignment.sh`.
5. The exact output file name with `--split-per-abi --target aarch64`. It should be
   `apk/arm64/release/app-arm64-release.apk`, but has not been run.
6. Whether `$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager` exists on the
   pinned image.

## Surprises that affect the plan

1. **The NDK is not pinned by doing nothing, and the obvious pin is wrong.**
   - Unpinned, Tauri takes the highest NDK on the runner, r30 today.
   - `ANDROID_NDK_HOME` points at r27, which is not 16 KB-aligned by default.
   - Tauri only reads `NDK_HOME`.
   - The plan's "pin an exact NDK" decision stands, but must be implemented as
     "install X and set `NDK_HOME`".
2. **`tauri-action` uploads an unsigned APK without failing** if signing is
   misconfigured. A signature or fingerprint check step is required.
3. **The test-build versionCode rationale in `docs/releasing.md` and the plan is
   wrong.** The versionCode comes from `tauri.conf.json`, not the tag (§7). The
   conclusion (keep test builds away from testers' update source) still holds.
4. **One keystore password, not two**, and **`-validity` must be explicit** (keytool
   defaults to 90 days).
5. **`bundle.externalBin: ["binaries/node"]` will probably break the Android
   build.** `tauri-build` copies `binaries/node-<target-triple>` for every target
   (`tauri-build/src/lib.rs:748-754`, `tauri-utils/src/resources.rs:45-60`), so
   `node-aarch64-linux-android` would be required.
   - A `tauri.android.conf.json` (merged by JSON merge-patch, `tauri-utils/src/config/parse.rs:185`)
     that sets `"externalBin": null` or `[]` should fix it.
   - **Medium**, not run. This is #315's question, flagged here because it fails
     the CI job.
6. **`docs/releasing.md` still describes F-Droid publishing as the Android path**
   (lines 45-53). Map #314 moves F-Droid (#158) out of v1, which ships a sideloaded
   APK on the GitHub release. That text, and the "two aliases" item in the plan,
   are ahead of v1. The handoff should mark them as not yet built, as AGENTS.md
   requires.
7. **The default `tauri android build` builds APK + AAB × 4 ABIs.** Without `--apk`
   and `--target`, the job does roughly 8× the necessary work.
