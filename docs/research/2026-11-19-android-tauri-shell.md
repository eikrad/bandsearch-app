# Research: what the Tauri shell needs to build for Android (#315)

Research ticket for map #314. Facts and a recommendation only, no code changes.
Written 2026-11-19 against `origin/staging` at `7e3d773`.

**Method.** I read the shell (`apps/desktop/src-tauri`) and checked every
upstream claim against the source of the **exact versions in `Cargo.lock`**
(fetched with `cargo fetch --locked`), plus the official Tauri v2 docs (through
Context7) and the Android developer docs. I ran no Android build: no `tauri
android init`, no NDK, no device. Anything that only a build can show is marked
**UNKNOWN**, with what the spike must check.

**Confidence scale.** *High*: I read the code path that decides it. *Medium*:
docs state it, or I read most of the path but not all. *Low*: inference.

## Pinned versions

| Component | Version | Source |
|---|---|---|
| `tauri` | 2.12.7 | `apps/desktop/src-tauri/Cargo.lock` |
| `tauri-build` | 2.7.6 | same |
| `tauri-macros` / `tauri-codegen` | 2.7.6 | same |
| `tauri-utils` | 2.10.4 | same |
| `tauri-runtime-wry` / `wry` | 2.12.5 / 0.57.0 | same |
| `tauri-plugin-opener` | 2.7.3 | same |
| `tauri-plugin-updater` | 2.14.1 | same |
| `dirs` / `dirs-sys` | 7.0.0 / 0.5.0 | same |
| `@tauri-apps/cli` | 2.12.6 | `package-lock.json:1093-1095` |

`tauri-cli-v2.12.6` and `tauri-v2.12.7` are the **same commit**
(`9319e539f34237035cb4693bed9246660bc0a926`, from `git ls-remote`), so the CLI
and the runtime come from one tree. In the links below, `TAURI` stands for
`https://github.com/tauri-apps/tauri/blob/tauri-v2.12.7`. The lockfile already
contains the Android-only dependency tree (`jni`, `ndk` …), so an Android build
needs no new crates beyond what the changes below add.

## Answers

### Q1. Mobile entry point: is a `lib.rs` with `#[tauri::mobile_entry_point]` and a `cdylib` crate needed?

**Yes, both.** *Confidence: high.*

- On mobile, Tauri builds the app as a shared library that the Android
  activity loads. The official migration guide says: "The mobile interface of
  Tauri requires your project to output a shared library". The steps are: add
  `[lib] crate-type = ["staticlib", "cdylib", "rlib"]`, move `main.rs` to
  `lib.rs`, rename `main` to `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub
  fn run()`, and make `main.rs` call `<lib>::run()`.
  Source: https://v2.tauri.app/start/migrate/from-tauri-1/ ("Preparing for
  Mobile"); also https://v2.tauri.app/start/project-structure/.
- The macro generates the JNI binding (`tauri::android_binding!`) from the
  `TAURI_ANDROID_PACKAGE_NAME_PREFIX` and `…_APP_NAME` environment variables.
  `tauri-build` derives these from `identifier`, so `app.bandsearch` gives
  `app` + `bandsearch`. Without `tauri_build::build()` in `build.rs` the macro
  fails to compile.
  Sources: `tauri-macros-2.7.6/src/mobile.rs` (`entry_point`);
  `TAURI/crates/tauri-build/src/lib.rs#L689-L705`. Our `build.rs` already calls
  it.
- The CLI takes the library name from `[lib] name` in `Cargo.toml`. If that
  key is missing, it falls back to the snake-cased package name. It exports the
  name to Gradle as `WRY_ANDROID_LIBRARY`.
  Sources: `TAURI/crates/tauri-cli/src/mobile/mod.rs#L613-L620`,
  `TAURI/crates/tauri-cli/src/interface/rust.rs#L1043-L1055`,
  `TAURI/crates/tauri-cli/src/mobile/android/mod.rs#L170`.
- **Use `name = "bandsearch_lib"`, not `bandsearch`.** The create-tauri-app
  template explains why: "The `_lib` suffix … is necessary to make the lib name
  unique and wouldn't conflict with the bin name. This seems to be only an
  issue on Windows" (cargo#8519). Windows is a release target here, so this
  matters.
  Source: `create-tauri-app/templates/_base_/src-tauri/Cargo.toml.lte`.
- The 270 lines of `#[cfg(test)]` in `main.rs` move with the code into
  `lib.rs`. `include_str!("../tauri.conf.json")` keeps working because the path
  is relative to `src/`. `npm run tauri:test` (`cargo test`) then tests the
  library.

**Side effects on desktop** (*medium*): adding `staticlib` and `cdylib` makes
every desktop `cargo build` also link those two library types, which costs
extra build time. `panic = "abort"` in `[profile.release]` turns the macro's
`catch_unwind` guard into a plain abort. That is harmless, but a Rust panic on
Android kills the app without a stack trace.

### Q2. Desktop-only code that must be gated

Our code uses the `desktop` / `mobile` cfg aliases, which `tauri_build::build()`
emits (`cfg_alias("desktop", !mobile)`,
`TAURI/crates/tauri-build/src/lib.rs#L670-L673`). `#[cfg(desktop)]` is
therefore available in our own crate. *High.*

#### 2a. The app menu: a compile error, not in the ticket

`tauri::menu` is `#[cfg(desktop)]` (`TAURI/crates/tauri/src/lib.rs#L111-L113`),
and so is `App::set_menu` (`TAURI/crates/tauri/src/app.rs#L980-L981`). The
shell imports `tauri::menu::{Menu, PredefinedMenuItem, Submenu}` (`main.rs:9`),
defines `build_app_menu` (`main.rs:478-484`) and calls `app.set_menu`
(`main.rs:623-624`). **None of this compiles for Android.** All three must be
gated with `#[cfg(desktop)]`. *High.* Neither the ticket nor the plan mentions
it.

#### 2b. `tauri-plugin-updater`: gate the crate, the code and the capability

- The plugin declares `[package.metadata.platforms.support.android] level =
  "none"` (`tauri-plugin-updater-2.14.1/Cargo.toml:54-56`). The official
  setup adds the crate only for
  `cfg(any(target_os = "macos", windows, target_os = "linux"))` and registers
  it under `#[cfg(desktop)]` (https://v2.tauri.app/plugin/updater/). *High.*
- **The plan's premise is wrong here.** Plan §"Forced by the platform" 2 says:
  "Our `let Ok(updater) = … else` already fails soft." That guard only runs if
  the crate builds and the plugin is registered for Android. Under the
  recommended setup, where the crate is a desktop-only dependency, these items
  stop compiling and each needs `#[cfg(desktop)]` (or a mobile stub):
  - `use tauri_plugin_updater::UpdaterExt;` (`main.rs:11`)
  - `.plugin(tauri_plugin_updater::Builder::new().build())` (`main.rs:620`)
  - `check_for_update_and_notify` (`main.rs:458-476`) and its spawn
    (`main.rs:641`)
  - the `install_update` command (`main.rs:603-615`)

  `generate_handler!` accepts per-item attributes, so
  `#[cfg(desktop)] install_update` works inside the list
  (`tauri-macros-2.7.6/src/command/handler.rs:13-21,155-177`). *High.*
  Alternatively, keep the crate for all targets and leave the soft-fail path in
  place. Whether the crate even compiles for `aarch64-linux-android` is
  **UNKNOWN**: its support level is "none" and I did not build it. I do not
  recommend that route.
- **Capability.** `capabilities/default.json:11` grants `updater:default`.
  `tauri-build` validates every capability that applies to the current target
  platform. A permission whose plugin is absent fails the build: `default` is
  waived only when the plugin's manifest exists, via
  `acl_manifests.get(key).map(…).unwrap_or(false)`
  (`tauri-build-2.7.6/src/acl.rs:341-380`). A capability whose `platforms` list
  excludes the target is skipped (same lines). So `updater:default` must move
  into a separate capability file with
  `"platforms": ["linux", "macOS", "windows"]`, which is the pattern the docs
  give (https://v2.tauri.app/security/capabilities/). *High.*
- `tauri.conf.json > plugins.updater` (`:41-51`) and
  `bundle.createUpdaterArtifacts` (`:26`) can stay. `tauri android build` does
  not use `tauri-bundler`: there is no reference to `external_bin`,
  `tauri_bundler` or updater artifacts anywhere in
  `crates/tauri-cli/src/mobile/`. *Medium-high:* I did a grep, I did not trace
  every call. To be safe, the Android override file can also null them (see
  Q3).
- Frontend: `listen("update-available")` on Android simply never fires.
  `invoke("install_update")` is only reachable from the banner, which never
  appears. No frontend change is required.

#### 2c. The Node sidecar, and does `externalBin: binaries/node` break the Android build?

**Yes, the build fails** unless Android's config drops `externalBin`. The
failure happens in `build.rs`, not in a bundle step. *High that it errors;
the exact message is UNKNOWN.*

- `tauri_build::try_build` runs for every target. It turns each `externalBin`
  entry into `<path>-<target_triple>` (`tauri-utils-2.10.4/src/resources.rs:45-60`)
  and copies it into the target directory
  (`TAURI/crates/tauri-build/src/lib.rs#L748-L755`). A missing source returns
  `Error::ResourcePathNotFound` (`resources.rs:206`), and `build()` exits 1
  (`lib.rs#L648-L661`). On Android the triples are `aarch64-linux-android`,
  `armv7-linux-androideabi`, `i686-linux-android` and `x86_64-linux-android`,
  and there is no `binaries/node-*-linux-android` file.
- Fix: put `{"bundle": {"externalBin": null}}` (or `[]`) in
  `tauri.android.conf.json`. The platform file is merged with **JSON Merge
  Patch (RFC 7396)**, in which `null` deletes a key and arrays are replaced
  whole (`tauri-utils-2.10.4/src/config/parse.rs:165-187`). `tauri-build` reads
  the merged config for the target platform (`lib.rs#L677-L688`). *High.*
  The existing test `tauri_conf_has_external_bin_for_node_sidecar`
  (`main.rs:750`) reads only the base file, so it stays green.
- The sidecar runtime path: `reconcile_sidecar` (`main.rs:435-447`) and
  `should_run_local_sidecar` (`main.rs:102-104`). On Android today:
  - `setup` calls `reconcile_sidecar`.
  - The endpoint is blank, so it takes the "start" branch.
  - `Command::new("node")` fails. `std::process::Command` does exist on
    Android, but there is no `node` binary, and exec from app-writable storage
    is forbidden for targetSdk ≥ 29
    (https://developer.android.com/about/versions/10/behavior-changes-10,
    "Removed execute permission for app home directory"; the Tauri template
    targets SDK 37).
  - The error is only logged (`main.rs:400-405`), so the app **does not
    crash**. But `apiEndpointUrl` stays `""`, so the frontend uses its built-in
    `http://localhost:3001` (`startDesktopBrowserApp.ts:127,191`) and never
    reaches the hosted API.

  The platform-conditional default (#159) is therefore what makes the app talk
  to the API at all. Simply gating the sidecar off is not enough. *High.*
- Also meaningless on Android, though not fatal: `resolve_workspace_root` /
  `load_dotenv` (`main.rs:277-317`; `current_exe` there is `app_process64`),
  `absolute_bandsearch_db_path`, and the `on_window_event` sidecar kill
  (`main.rs:652-660`). Gate them with the sidecar for clarity.
- **The plan's premise is partly wrong here as well.** Plan "Forced by the
  platform" 1 attributes the ban to "Tauri's shell plugin on mobile is
  restricted to opening URLs". This shell does not use the shell plugin. It
  calls `std::process::Command` directly (`main.rs:367`). The real constraints
  are three:
  1. No Node build for Android in `externalBin`, and `build.rs` fails on that.
  2. Android's W^X rule on exec from app storage.
  3. The sidecar runs `node --import tsx services/api/src/server.ts` out of a
     repository checkout (`main.rs:260-274, 293-306`), which no installed app
     has.

  The conclusion, remote-API-only, stands.

#### 2d. `dirs`-based config path: where does config live on Android?

- `config_file_path()` (`main.rs:115-118`) uses `dirs::config_dir()`. On
  Android, `dirs` 7 takes the generic Unix branch: `$XDG_CONFIG_HOME`, else
  `home_dir()/.config` (`dirs-7.0.0/src/lin.rs:9`). `home_dir()` reads `$HOME`,
  and on Android the `getpwuid` fallback is compiled to `None`
  (`dirs-sys-0.5.0/src/lib.rs:33-42`). *High.*
- Whether `$HOME` is set in an Android app process is **UNKNOWN**.
  - If it is unset, `config_dir()` returns `None`. Every load then yields
    defaults, and every save fails with "config directory not found". The
    Settings endpoint override (#159) would silently not persist.
  - If it is set to something unwritable, the result is the same.
  - The spike should log `std::env::var("HOME")` and
    `dirs::config_dir()` to logcat.

  Either way, do not rely on it.
- **Recommendation:** resolve the path through Tauri:
  `app.path().app_config_dir()`. On Android this calls the Kotlin
  `PathPlugin.getConfigDir`, which returns `activity.dataDir`, i.e.
  `/data/user/0/app.bandsearch`. That location is app-private and needs no
  permission (`TAURI/crates/tauri/src/path/android.rs#L144-L146`,
  `TAURI/crates/tauri/mobile/android/src/main/java/app/tauri/PathPlugin.kt#L55-L57`).
  *High.* The doc comment on that function says
  "`config_dir/${bundle_identifier}`", but the code returns `dataDir` with no
  suffix. That is harmless, because `dataDir` is already per-app.
- This is a refactor, not a one-line cfg. `config_file_path`, `load_config`
  and `persist_config` are free functions without an `AppHandle`, and they are
  called from commands and from `reconcile_sidecar`. The cleanest seam is to
  resolve the path once in `setup` and `manage()` it as state, or to pass the
  directory in. Keep `dirs` on desktop so existing desktop users keep their
  `~/.config/bandsearch/config.json`. Desktop's `app_config_dir()` would point
  at a **different** directory (`~/.config/app.bandsearch/`), and switching
  desktop to it would lose existing configs without a migration.

### Q3. Android-specific config (`tauri.android.conf.json`)

- **The file exists as a concept and is merged automatically.**
  `tauri.android.conf.json` (or `.json5`, or `Tauri.android.toml`) sits next to
  `tauri.conf.json` and is merged by RFC 7396
  (`tauri-utils-2.10.4/src/config/parse.rs:51-71,165-187`). *High.*
- **`minSdkVersion`**: the key is `bundle.android.minSdkVersion` (alias
  `min-sdk-version`). The default is **24**, which confirms the plan's "raised
  above the Tauri default of 24"
  (`TAURI/crates/tauri-utils/src/config.rs#L3653-L3703`). *High.*
  - **Trap:** the value is written into
    `gen/android/app/build.gradle.kts` (`minSdk = {{android.min-sdk-version}}`)
    when the template is rendered at `tauri android init`
    (`TAURI/crates/tauri-cli/templates/mobile/android/app/build.gradle.kts#L25`).
  - I found no code in `tauri-cli` or `tauri-build` that rewrites `minSdk` in
    an existing project. The only use is `mod.rs#L151`, which feeds the
    project generator. `tauri-build` regenerates only
    `tauri.build.gradle.kts` and `tauri.settings.gradle`
    (`tauri-build-2.7.6/src/mobile.rs:147+`).
  - So set `minSdkVersion: 29` **before** `tauri android init`, or edit
    `build.gradle.kts` afterwards. *Medium:* I did not read `cargo-mobile2`'s
    generator.
  - The spike should change the value after init, rebuild, and check
    `aapt dump badging` for `sdkVersion`.
- **`versionCode`**: the plan's formula is **correct**:
  `version.major * 1000000 + version.minor * 1000 + version.patch`
  (`TAURI/crates/tauri-cli/src/mobile/android/mod.rs#L1173`, also in the doc
  comment at `config.rs#L3664-L3671`). *High.*
  - It is written to `gen/android/app/tauri.properties`, which Gradle reads
    (`build.gradle.kts#L27`) and which is gitignored.
  - `0.4.5` gives `4005`.
  - `semver::Version::parse` ignores pre-release tags, so `0.4.1-test` and
    `0.4.1` share a code. That confirms the plan's "test builds never reach
    the repo" rule.
  - Precedence: `autoIncrementVersionCode` (off by default), then an explicit
    `versionCode`, then the formula. So leaving `versionCode` unset gives the
    formula, as the plan says.
  - **New caveat:** the formula collides once `patch ≥ 1000` (`0.4.1000` =
    `0.5.0`) or `minor ≥ 1000`. Each minor line therefore allows 999 patch
    releases. That is far looser than the earlier ×100 scheme, but still a
    ceiling. Worth one line in `docs/releasing.md`.
  - `0.0.0` is rejected, and so is any code above 2,100,000,000.
- **Default API endpoint.** There is no Tauri config key for app-defined
  values. Putting `https://bandsearch-api.onrender.com` into
  `tauri.android.conf.json` would mean abusing `plugins.<name>`. Recommended:
  a Rust function `default_api_endpoint() -> &'static str` that returns the URL
  under `#[cfg(mobile)]` and `""` on desktop. `llm_config_status` reports it
  when the stored value is blank, and `should_run_local_sidecar` is never
  reached on mobile. This matches the plan's #159 note. *Design choice, no
  upstream fact involved.*
- **Stale name in the plan.** It says the frontend reads
  `gemini_config_status.apiEndpointUrl`. The command is now
  `llm_config_status` (`main.rs:487`).
- **Suggested `tauri.android.conf.json`** (to be verified by the spike):

  ```json
  {
    "bundle": {
      "externalBin": null,
      "createUpdaterArtifacts": false,
      "android": { "minSdkVersion": 29 }
    },
    "plugins": { "updater": null }
  }
  ```

  The two updater lines are belt-and-braces; only `externalBin: null` is known
  to be required.

### Q4. Customising `AndroidManifest.xml` (permissions, `allowBackup`, cleartext)

- **Edit the generated file directly.**
  `tauri android init` creates `src-tauri/gen/android/`, including
  `app/src/main/AndroidManifest.xml`. The official docs add permissions by
  editing that file (https://v2.tauri.app/plugin/file-system/, Android
  section). *High.*
  - `ensure_init` refuses to build if `gen/android` is missing
    (`TAURI/crates/tauri-cli/src/mobile/mod.rs#L655-L667`).
  - The CLI's own `.gitignore` inside `gen/android/app` ignores only
    generated pieces: `tauri.properties`, `tauri.build.gradle.kts`, the
    `jniLibs/*.so`, `assets/tauri.conf.json`, `proguard-tauri.pro` and
    `**/generated`.
  - So the project is meant to be **committed**, and hand edits survive
    builds.
  - Signing config goes into `gen/android/app/build.gradle.kts` plus a
    gitignored `keystore.properties` (https://v2.tauri.app/distribute/sign/android/).
    That belongs to the CI ticket, not the shell.
- **What the template already contains** (`TAURI/crates/tauri-cli/templates/mobile/android/app/src/main/AndroidManifest.xml`):
  - `INTERNET` permission: present. Enough for the hosted API.
  - `usesCleartextTraffic="${usesCleartextTraffic}"`, set to `false` for
    release and `true` for debug (`build.gradle.kts#L23,L35`). The API is
    HTTPS, so nothing to change.
    - Android notes that this attribute is "getting deprecated and will be
      ignored for apps targeting API levels 38 and above" in favour of a
      Network Security Config. The template targets 37, so this is a future
      item only.
    - A self-hosted `http://` endpoint entered in Settings would be blocked in
      release builds. That is acceptable, but Settings copy might mention it.
  - `allowBackup`: **absent, so Android's default `true` applies**
    (https://developer.android.com/guide/topics/manifest/application-element#allowbackup).
    *High.* Auto Backup then copies app data to the user's Google Drive. That
    includes WebView `localStorage`, where the **auth token** lives
    (`apps/desktop/src/authTokenStore.ts:3-8`), and the config file in
    `dataDir`.
    - **Recommend `android:allowBackup="false"`.** A closed beta with bearer
      tokens gains nothing from cloud restore. The alternative is
      `dataExtractionRules` that exclude those files.
    - On Android 12+, some vendors force device-to-device transfer even with
      `false` (same page). Acceptable.
  - Plus a leanback / Android TV launcher category and a `FileProvider`. Both
    are harmless. The TV entries could be removed if TV is not a target.
- `RECORD_AUDIO` (#157, voice) is a later addition to the same file. Out of
  scope here.

### Q5. `tauri-plugin-opener` on Android (external links)

**It works for URLs.** *High.*

- Support level: `android: partial, "Only allows to open URLs via open"`
  (`tauri-plugin-opener-2.7.3/Cargo.toml`, `[package.metadata.platforms.support.android]`).
- The plugin registers a Kotlin plugin on Android
  (`src/lib.rs:236-237`). `open_url` calls it on mobile (`src/lib.rs:99-107`),
  and the Kotlin side fires `Intent.ACTION_VIEW` with `FLAG_ACTIVITY_NEW_TASK`,
  i.e. the default browser (`android/src/main/java/OpenerPlugin.kt:26-38`).
  Passing `with: "inAppBrowser"` opens a Custom Tab instead.
- The scope check is the same as on desktop (`src/commands.rs:15-41`). The
  existing `opener:allow-default-urls` (`capabilities/default.json:10`) allows
  `http(s)://`, `mailto:` and `tel:` (`permissions/allow-default-urls.toml`).
  No capability change is needed.
- `open_path` / `reveal_item_in_dir` are not available on mobile. We don't use
  them; the frontend only calls `openUrl` (`apps/desktop/src/openExternalLink.ts:23-29`).
- `startActivity(ACTION_VIEW)` does not need a `<queries>` element. Package
  visibility rules on Android 11+ apply to *querying* other apps, not to
  launching an implicit intent. *Medium:* from Android platform knowledge; I
  did not fetch the page.

## Things not in the ticket that affect "starts and talks to the hosted API"

- **WebView origin and CORS.**
  - On Android, the page origin is `http://tauri.localhost`
    (`https://tauri.localhost` with `app.windows[].useHttpsScheme: true`)
    (`TAURI/crates/tauri/src/manager/mod.rs#L335,L802-L810`).
  - The API runs `cors({ origin: CORS_ORIGIN || "*" })`
    (`services/api/src/app.ts:91-93`, `config/env.ts:109`), and `render.yaml`
    sets no `CORS_ORIGIN`. Auth is a bearer header, not cookies, so `*` is
    valid. Works today. *High.*
  - **Risk:** anyone who later locks `CORS_ORIGIN` down to a single value
    breaks Android and/or desktop. Desktop origins differ by OS:
    `tauri://localhost` on macOS/Linux, `http://tauri.localhost` on Windows.
- **Choose `useHttpsScheme` before the first tester install.** `localStorage`
  is per origin. Flipping the scheme later logs every tester out and loses
  their stored state. Default `false` is fine; just decide once. *Medium:*
  the Tauri config docs warn about this for the Windows scheme switch.
- **Window config.** `width`, `minWidth` and the like are applied only under
  `#[cfg(desktop)]` (`TAURI/crates/tauri/src/window/mod.rs` around L257-L276),
  so `tauri.conf.json > app.windows` needs no Android override. *Medium-high.*
- **LLM, Brave and Turso commands** (`save_llm_api_key`, `save_turso_config`
  …) still compile on Android. Once `reconcile_sidecar` is a no-op on mobile,
  they become inert. The mobile Settings UI (#156) hides them anyway.

## Recommendation: required changes to the Rust shell, in order

1. **Split the crate.**
   - Add `[lib] name = "bandsearch_lib"`,
     `crate-type = ["staticlib", "cdylib", "rlib"]`.
   - Move `main.rs` to `lib.rs` and turn `main()` into
     `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`.
   - Make the new `main.rs` hold only `windows_subsystem` and
     `bandsearch_lib::run()`. Tests move with the code.
   - Verify with `cargo test` and a desktop `tauri build` before going
     further. This step is a pure refactor.
2. **Gate the menu.** Put `#[cfg(desktop)]` on the `tauri::menu` import,
   `build_app_menu` and the `set_menu` call. Without this, Android does not
   compile.
3. **Make the updater desktop-only.**
   - Move `tauri-plugin-updater` to
     `[target.'cfg(any(target_os = "macos", windows, target_os = "linux"))'.dependencies]`.
   - Put `#[cfg(desktop)]` on the import, the plugin registration, the
     update-check spawn, `check_for_update_and_notify`, `can_auto_install`
     and `install_update`, including inside `generate_handler!`.
   - Move `updater:default` into `capabilities/desktop.json` with
     `"platforms": ["linux", "macOS", "windows"]`.
4. **Gate the sidecar.** Put `#[cfg(desktop)]` on the sidecar lifecycle
   (`reconcile_sidecar` and the functions it uses, the workspace root and
   dotenv, `on_window_event`). Make `should_run_local_sidecar` return `false`
   on mobile; better, never call it there.
5. **Add a platform-conditional endpoint default (#159).**
   - `default_api_endpoint()` returns `https://bandsearch-api.onrender.com`
     under `cfg(mobile)` and `""` on desktop.
   - `llm_config_status` returns it when the stored value is blank.
   - Saving a blank value on mobile means "back to the default", not "start a
     sidecar".
   - Unit-test the pure function per platform.
6. **Move the config path to Tauri's path API on mobile.**
   - Resolve the config directory in `setup` (`app.path().app_config_dir()` on
     mobile, `dirs::config_dir()/bandsearch` on desktop, unchanged) and
     `manage()` it.
   - Thread it through `load_config` / `persist_config`.
7. **Add `tauri.android.conf.json`** with `bundle.externalBin: null` (required)
   and `bundle.android.minSdkVersion: 29`, plus the optional updater nulls
   from Q3. Leave `versionCode` unset.
8. **Generate the project.** Run `tauri android init` (after step 7, so
   `minSdk = 29` lands in `build.gradle.kts`), commit `gen/android/`, and set
   `android:allowBackup="false"` in its `AndroidManifest.xml`. Signing goes in
   later, with the CI ticket.

Steps 1–6 are testable on desktop with `cargo test` / `cargo check`. Steps 2–4
can also be checked without a phone with
`cargo check --target aarch64-linux-android`, which needs
`rustup target add aarch64-linux-android`. Its `build.rs` still needs
`tauri.android.conf.json` from step 7, so do 7 first if you use this check.
Note `cargo check` against an Android target only proves the Rust compiles; it
does not touch Gradle.

## UNKNOWNs a spike must settle

| Unknown | What a real build or run must show |
|---|---|
| Is `$HOME` set in an Android app process, and what does `dirs::config_dir()` return? | Log both to logcat on the phone. Only matters if step 6 is skipped. |
| Does `tauri-plugin-updater` 2.14.1 compile for Android? | `cargo check --target aarch64-linux-android` with the crate kept unconditional. Only matters if step 3's target-gating is rejected. |
| Exact failure text when `externalBin` is left in | `tauri android build` without the override. Expect `ResourcePathNotFound` for `binaries/node-aarch64-linux-android`. |
| Does a later `minSdkVersion` change reach an existing `gen/android`? | Init with 24, set 29, rebuild, run `aapt dump badging app-release.apk \| grep sdkVersion`. |
| Is `versionCode` 4005 for 0.4.5 in the built APK? | `aapt dump badging` → `versionCode='4005' versionName='0.4.5'`. |
| Does the release build reach `https://bandsearch-api.onrender.com` from `http://tauri.localhost` (CORS preflight, TLS, cold start)? | Install on the Android 10+ phone, log in with an invite account, send one chat message. Note: the 42 s cold start vs. `ConnectingView`'s timeout is #144 / UI territory. |
| Does `openUrl` open the system browser from a link in a recommendation card? | Tap one external link on the device. |
| Is a panic with `panic = "abort"` diagnosable? | Force one in a debug build and check logcat. Decide whether Android needs `tauri-plugin-log` or a panic hook. |
| Which ABIs and output (`--apk` vs. AAB, universal vs. split) does `tauri android build` produce for the GitHub release? | Belongs to the CI ticket. Record the spike's output listing. |

## Surprises that affect the plan

1. **The app menu breaks the Android compile.** `tauri::menu` and `set_menu`
   are desktop-only. This is missing from both the ticket and the plan.
2. **The updater does not "fail soft".** It must be removed from the Android
   build: crate, code and **capability**. A capability that names
   `updater:default` with no `platforms` restriction fails `tauri-build`'s ACL
   check once the crate is desktop-only.
3. **`externalBin` breaks Android in `build.rs`**, not in a bundle step. A
   one-line `tauri.android.conf.json` fixes it.
4. **The sidecar reasoning cites the wrong mechanism** (the shell plugin is not
   used). The conclusion stands. Android today would not crash, but it would
   silently target `localhost:3001`, so #159 is required for v1, not optional.
5. **The config path probably doesn't persist on Android** with
   `dirs::config_dir()`, so the Settings endpoint override from #159 needs
   step 6.
6. **`minSdkVersion` is baked in at `init`.** Set it before generating the
   project.
7. **`allowBackup` defaults to `true`** and would back up the auth token.
   Decide it explicitly.
8. **`versionCode` is confirmed.** One new ceiling: patch < 1000 per minor.
9. **The plan has a stale name:** `gemini_config_status` is now
   `llm_config_status`.
