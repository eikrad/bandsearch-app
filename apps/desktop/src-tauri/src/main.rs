#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{Manager, State, WindowEvent};

struct ApiProcess(Mutex<Option<Child>>);

#[derive(Clone)]
struct WorkspaceRoot(PathBuf);

#[derive(Default, Deserialize, Serialize)]
struct BandsearchConfig {
    #[serde(default)]
    gemini_api_key: String,
    #[serde(default)]
    brave_api_key: String,
    #[serde(default)]
    onboarding_completed: bool,
    #[serde(default)]
    turso_database_url: String,
    #[serde(default)]
    turso_auth_token: String,
    #[serde(default)]
    jwt_secret: String,
    #[serde(default)]
    api_endpoint_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiConfigStatus {
    has_stored_key: bool,
    has_brave_key: bool,
    onboarding_complete: bool,
    has_turso_config: bool,
    gemini_key_from_env: bool,
    brave_key_from_env: bool,
    turso_from_env: bool,
    api_endpoint_url: String,
}

/// Returns true when the named environment variable is set to a non-blank value.
fn env_non_empty(name: &str) -> bool {
    std::env::var(name).map(|v| !v.trim().is_empty()).unwrap_or(false)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveGeminiApiKeyRequest {
    api_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBraveApiKeyRequest {
    api_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTursoConfigRequest {
    database_url: String,
    auth_token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveApiEndpointUrlRequest {
    url: String,
}

/// The local API sidecar runs only when no remote endpoint is configured.
/// A blank (or whitespace-only) endpoint means "use the local sidecar".
fn should_run_local_sidecar(api_endpoint_url: &str) -> bool {
    api_endpoint_url.trim().is_empty()
}

/// Defensive http(s) URL check for the configured remote endpoint. The friendly,
/// user-facing validation lives in the settings controller (`new URL(...)`); this
/// is a last-resort guard so a malformed value never reaches the spawn logic.
fn is_valid_http_url(value: &str) -> bool {
    let v = value.trim();
    (v.starts_with("http://") && v.len() > "http://".len())
        || (v.starts_with("https://") && v.len() > "https://".len())
}

fn config_file_path() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "config directory not found".to_string())?;
    Ok(base.join("bandsearch").join("config.json"))
}

fn load_config() -> BandsearchConfig {
    let Ok(path) = config_file_path() else {
        return BandsearchConfig::default();
    };
    let Ok(data) = std::fs::read_to_string(&path) else {
        return BandsearchConfig::default();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn persist_config(cfg: &BandsearchConfig) -> Result<(), String> {
    let path = config_file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

fn gemini_key_for_spawn() -> Option<String> {
    let cfg = load_config();
    let trimmed = cfg.gemini_api_key.trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

fn brave_key_for_spawn() -> Option<String> {
    let cfg = load_config();
    let trimmed = cfg.brave_api_key.trim();
    if !trimmed.is_empty() {
        return Some(trimmed.to_string());
    }
    // Fall back to env aliases so BRAVE_SEARCH_API_KEY in .env also works
    for name in &["BRAVE_API_KEY", "BRAVE_SEARCH_API_KEY"] {
        if let Ok(v) = std::env::var(name) {
            let v = v.trim().to_string();
            if !v.is_empty() { return Some(v); }
        }
    }
    None
}

/// Generates a 32-byte hex secret from /dev/urandom (Unix) or RandomState fallback.
fn generate_jwt_secret() -> String {
    #[cfg(unix)]
    {
        use std::io::Read;
        if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
            let mut buf = [0u8; 32];
            if f.read_exact(&mut buf).is_ok() {
                return buf.iter().map(|b| format!("{:02x}", b)).collect();
            }
        }
    }
    // Fallback: combine multiple RandomState seeds (each seeded from OS entropy).
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    (0..4)
        .map(|_| format!("{:016x}", RandomState::new().build_hasher().finish()))
        .collect()
}

/// Returns a stable JWT secret for the API sidecar.
/// Priority: JWT_SECRET env var → stored config value → generate + persist.
fn ensure_jwt_secret() -> String {
    if let Ok(v) = std::env::var("JWT_SECRET") {
        let v = v.trim().to_string();
        if !v.is_empty() { return v; }
    }
    let mut cfg = load_config();
    if !cfg.jwt_secret.trim().is_empty() {
        return cfg.jwt_secret.trim().to_string();
    }
    let secret = generate_jwt_secret();
    cfg.jwt_secret = secret.clone();
    let _ = persist_config(&cfg);
    secret
}

fn turso_for_spawn() -> (Option<String>, Option<String>) {
    let cfg = load_config();
    let url = cfg.turso_database_url.trim().to_string();
    let token = cfg.turso_auth_token.trim().to_string();
    let url_opt = if url.is_empty() { None } else { Some(url) };
    let token_opt = if token.is_empty() { None } else { Some(token) };
    (url_opt, token_opt)
}

fn wait_for_api_tcp(port: u16) {
    let addr: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .expect("valid listen addr");
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if TcpStream::connect(addr).is_ok() {
            eprintln!("[bandsearch] API TCP ready on port {port}");
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    eprintln!("[bandsearch] warning: API port {port} did not accept TCP within 30s");
}

/// Returns the expected filename of the bundled Node sidecar for the current platform.
/// `env!("TARGET")` is the full Rust target triple baked in at compile time (e.g.
/// `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`), matching the name Tauri's
/// bundler uses for the sidecar placed next to the executable.
fn sidecar_name() -> String {
    if cfg!(target_os = "windows") {
        format!("node-{}.exe", env!("TARGET"))
    } else {
        format!("node-{}", env!("TARGET"))
    }
}

/// Resolves the Node binary to use for spawning the API server.
/// Prefers a bundled sidecar binary placed next to the executable by `tauri build`;
/// falls back to the system `node` for dev and CI.
fn resolve_node_binary_in(exe_dir: &Path) -> String {
    let candidate = exe_dir.join(sidecar_name());
    if candidate.exists() {
        candidate.to_string_lossy().into_owned()
    } else {
        "node".to_string()
    }
}

fn resolve_node_binary() -> String {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return resolve_node_binary_in(dir);
        }
    }
    "node".to_string()
}

fn api_spawn_args(workspace_root: &Path) -> (String, Vec<String>) {
    let server_path = workspace_root
        .join("services")
        .join("api")
        .join("src")
        .join("server.ts");
    (
        resolve_node_binary(),
        vec![
            "--import".to_string(),
            "tsx".to_string(),
            server_path.to_string_lossy().into_owned(),
        ],
    )
}

/// Load a `.env` file into the current process environment without overriding existing vars.
fn load_dotenv(workspace_root: &Path) {
    let path = workspace_root.join(".env");
    let Ok(contents) = std::fs::read_to_string(&path) else { return };
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        if let Some((key, value)) = line.split_once('=') {
            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if std::env::var(key).is_err() {
                std::env::set_var(key, value);
            }
        }
    }
}

/// Walk up from `start` until we find the repo root that contains `services/api/src/server.ts`.
fn resolve_workspace_root_from(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let server_js = ancestor
            .join("services")
            .join("api")
            .join("src")
            .join("server.ts");
        if server_js.is_file() {
            return Some(ancestor.to_path_buf());
        }
    }
    None
}

/// Prefer stable discovery from the executable path so release GUI launches do not rely on
/// `current_dir()` (which varies and causes SQLite to open different `bandsearch.db` files).
fn resolve_workspace_root() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = resolve_workspace_root_from(&exe) {
            return root;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn absolute_bandsearch_db_path(workspace_root: &Path) -> String {
    let normalized_root = workspace_root.canonicalize().unwrap_or_else(|_| workspace_root.to_path_buf());
    normalized_root
        .join("bandsearch.db")
        .to_string_lossy()
        .into_owned()
}

fn spawn_api_child(
    workspace_root: &Path,
    gemini_key: Option<&str>,
    brave_key: Option<&str>,
    turso_url: Option<&str>,
    turso_token: Option<&str>,
    jwt_secret: &str,
) -> Result<Child, std::io::Error> {
    let (binary, args) = api_spawn_args(workspace_root);
    let mut cmd = Command::new(&binary);
    cmd.args(&args).current_dir(workspace_root);
    cmd.env("DATABASE_PATH", absolute_bandsearch_db_path(workspace_root));
    cmd.env("JWT_SECRET", jwt_secret);
    if let Some(k) = gemini_key {
        let t = k.trim();
        if !t.is_empty() {
            cmd.env("GEMINI_API_KEY", t);
        }
    }
    if let Some(k) = brave_key {
        let t = k.trim();
        if !t.is_empty() {
            cmd.env("BRAVE_API_KEY", t);
        }
    }
    if let Some(url) = turso_url {
        let t = url.trim();
        if !t.is_empty() {
            cmd.env("PREFERENCE_STORE", "turso");
            cmd.env("TURSO_DATABASE_URL", t);
            if let Some(tok) = turso_token {
                let tt = tok.trim();
                if !tt.is_empty() {
                    cmd.env("TURSO_AUTH_TOKEN", tt);
                }
            }
        }
    }
    cmd.spawn()
}

fn api_listen_port() -> u16 {
    std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3001)
}

fn start_api_sidecar(
    api: &ApiProcess,
    workspace_root: &Path,
    gemini_key: Option<&str>,
    brave_key: Option<&str>,
    turso_url: Option<&str>,
    turso_token: Option<&str>,
    jwt_secret: &str,
) {
    match spawn_api_child(workspace_root, gemini_key, brave_key, turso_url, turso_token, jwt_secret) {
        Ok(child) => {
            if let Ok(mut guard) = api.0.lock() {
                *guard = Some(child);
            }
            wait_for_api_tcp(api_listen_port());
        }
        Err(e) => {
            eprintln!("failed to start API process: {e}");
            if let Ok(mut guard) = api.0.lock() {
                *guard = None;
            }
        }
    }
}

/// Kills the running API sidecar child, if any, and clears the slot.
fn stop_api_sidecar(api: &ApiProcess) {
    if let Ok(mut guard) = api.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
}

fn restart_api_sidecar(
    api: &ApiProcess,
    workspace_root: &Path,
    gemini_key: Option<&str>,
    brave_key: Option<&str>,
    turso_url: Option<&str>,
    turso_token: Option<&str>,
    jwt_secret: &str,
) {
    stop_api_sidecar(api);
    start_api_sidecar(api, workspace_root, gemini_key, brave_key, turso_url, turso_token, jwt_secret);
}

/// Single source of truth for the local-sidecar lifecycle. Reads the current config
/// and reconciles the running process with it: (re)start the sidecar when no remote
/// endpoint is set, otherwise stop it. Every settings change funnels through here so
/// the invariant "local sidecar runs iff no remote endpoint" holds in one place.
fn reconcile_sidecar(api: &ApiProcess, workspace_root: &Path) {
    let cfg = load_config();
    if should_run_local_sidecar(&cfg.api_endpoint_url) {
        let gemini = gemini_key_for_spawn();
        let brave = brave_key_for_spawn();
        let (turso_url, turso_tok) = turso_for_spawn();
        let jwt = ensure_jwt_secret();
        restart_api_sidecar(api, workspace_root, gemini.as_deref(), brave.as_deref(), turso_url.as_deref(), turso_tok.as_deref(), &jwt);
    } else {
        eprintln!("[bandsearch] remote API endpoint configured — stopping local sidecar");
        stop_api_sidecar(api);
    }
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let quit = PredefinedMenuItem::quit(app, Some("Quit Bandsearch"))?;
    let about = PredefinedMenuItem::about(app, Some("About Bandsearch"), None)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let app_submenu = Submenu::with_items(app, "Bandsearch", true, &[&about, &separator, &quit])?;
    Menu::with_items(app, &[&app_submenu])
}

#[tauri::command]
fn gemini_config_status() -> Result<GeminiConfigStatus, String> {
    let cfg = load_config();
    let gemini_in_config = !cfg.gemini_api_key.trim().is_empty();
    let brave_in_config = !cfg.brave_api_key.trim().is_empty();
    let turso_in_config = !cfg.turso_database_url.trim().is_empty();

    let gemini_key_from_env = !gemini_in_config && env_non_empty("GEMINI_API_KEY");
    let brave_key_from_env = !brave_in_config && (env_non_empty("BRAVE_API_KEY") || env_non_empty("BRAVE_SEARCH_API_KEY"));
    let turso_from_env = !turso_in_config && env_non_empty("TURSO_DATABASE_URL");

    Ok(GeminiConfigStatus {
        has_stored_key: gemini_in_config || gemini_key_from_env,
        has_brave_key: brave_in_config || brave_key_from_env,
        onboarding_complete: cfg.onboarding_completed,
        has_turso_config: turso_in_config || turso_from_env,
        gemini_key_from_env,
        brave_key_from_env,
        turso_from_env,
        api_endpoint_url: cfg.api_endpoint_url.trim().to_string(),
    })
}

#[tauri::command]
fn save_gemini_api_key(
    workspace: State<'_, WorkspaceRoot>,
    api: State<'_, ApiProcess>,
    req: SaveGeminiApiKeyRequest,
) -> Result<(), String> {
    let trimmed = req.api_key.trim();
    if trimmed.is_empty() {
        return Err("API key is empty".into());
    }
    let mut cfg = load_config();
    cfg.gemini_api_key = trimmed.to_string();
    cfg.onboarding_completed = true;
    persist_config(&cfg)?;
    reconcile_sidecar(api.inner(), &workspace.0);
    Ok(())
}

#[tauri::command]
fn save_brave_api_key(
    workspace: State<'_, WorkspaceRoot>,
    api: State<'_, ApiProcess>,
    req: SaveBraveApiKeyRequest,
) -> Result<(), String> {
    let trimmed = req.api_key.trim();
    if trimmed.is_empty() {
        return Err("Brave API key is empty".into());
    }
    let mut cfg = load_config();
    cfg.brave_api_key = trimmed.to_string();
    persist_config(&cfg)?;
    reconcile_sidecar(api.inner(), &workspace.0);
    Ok(())
}

#[tauri::command]
fn save_turso_config(
    workspace: State<'_, WorkspaceRoot>,
    api: State<'_, ApiProcess>,
    req: SaveTursoConfigRequest,
) -> Result<(), String> {
    let url = req.database_url.trim();
    if url.is_empty() {
        return Err("database URL is empty".into());
    }
    let mut cfg = load_config();
    cfg.turso_database_url = url.to_string();
    cfg.turso_auth_token = req.auth_token.trim().to_string();
    persist_config(&cfg)?;
    reconcile_sidecar(api.inner(), &workspace.0);
    Ok(())
}

#[tauri::command]
fn clear_turso_config(
    workspace: State<'_, WorkspaceRoot>,
    api: State<'_, ApiProcess>,
) -> Result<(), String> {
    let mut cfg = load_config();
    cfg.turso_database_url = String::new();
    cfg.turso_auth_token = String::new();
    persist_config(&cfg)?;
    reconcile_sidecar(api.inner(), &workspace.0);
    Ok(())
}

#[tauri::command]
fn save_api_endpoint_url(
    workspace: State<'_, WorkspaceRoot>,
    api: State<'_, ApiProcess>,
    req: SaveApiEndpointUrlRequest,
) -> Result<(), String> {
    let trimmed = req.url.trim();
    if !trimmed.is_empty() && !is_valid_http_url(trimmed) {
        return Err("API endpoint must be an http(s) URL".into());
    }
    let mut cfg = load_config();
    cfg.api_endpoint_url = trimmed.to_string();
    persist_config(&cfg)?;
    // Reconcile the sidecar: a remote endpoint stops the local one; clearing it
    // (blank URL) restarts the local sidecar with the stored keys.
    reconcile_sidecar(api.inner(), &workspace.0);
    Ok(())
}

#[tauri::command]
fn complete_onboarding() -> Result<(), String> {
    let mut cfg = load_config();
    cfg.onboarding_completed = true;
    persist_config(&cfg)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![gemini_config_status, save_gemini_api_key, save_brave_api_key, save_turso_config, clear_turso_config, save_api_endpoint_url, complete_onboarding])
        .setup(|app| {
            let menu = build_app_menu(&app.handle())?;
            app.set_menu(menu)?;

            let workspace_root = resolve_workspace_root();
            load_dotenv(&workspace_root);
            eprintln!("[bandsearch] workspace_root: {}", workspace_root.display());
            eprintln!(
                "[bandsearch] DATABASE_PATH: {}",
                absolute_bandsearch_db_path(&workspace_root)
            );

            let api = ApiProcess(Mutex::new(None));
            // Start the local sidecar only when no remote endpoint is configured.
            reconcile_sidecar(&api, &workspace_root);

            app.manage(api);
            app.manage(WorkspaceRoot(workspace_root));

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    if let Some(state) = window.try_state::<ApiProcess>() {
                        stop_api_sidecar(&state);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_title_is_configured() {
        let conf = include_str!("../tauri.conf.json");
        let parsed: serde_json::Value =
            serde_json::from_str(conf).expect("tauri.conf.json must be valid JSON");
        let title = parsed["app"]["windows"][0]["title"]
            .as_str()
            .expect("window title must be set");
        assert_eq!(title, "Bandsearch");
    }

    #[test]
    fn product_name_is_bandsearch() {
        let conf = include_str!("../tauri.conf.json");
        let parsed: serde_json::Value =
            serde_json::from_str(conf).expect("tauri.conf.json must be valid JSON");
        let name = parsed["productName"].as_str().expect("productName must be set");
        assert_eq!(name, "Bandsearch");
    }

    #[test]
    fn api_spawn_args_points_to_server_js() {
        let root = PathBuf::from("/workspace");
        let (binary, args) = api_spawn_args(&root);
        assert_eq!(binary, "node");
        assert_eq!(args.len(), 3);
        assert_eq!(args[0], "--import");
        assert_eq!(args[1], "tsx");
        assert!(
            args[2].ends_with("services/api/src/server.ts"),
            "expected server.ts path, got: {}",
            args[2]
        );
    }

    #[test]
    fn api_spawn_args_binary_is_node() {
        let root = PathBuf::from("/any/root");
        let (binary, _) = api_spawn_args(&root);
        assert_eq!(binary, "node");
    }

    #[test]
    fn sidecar_name_reflects_current_os() {
        let name = sidecar_name();
        if cfg!(target_os = "windows") {
            assert!(name.ends_with(".exe"), "Windows sidecar must end with .exe, got: {name}");
            assert!(name.contains("windows"), "Windows sidecar must contain 'windows', got: {name}");
        } else if cfg!(target_os = "macos") {
            assert!(!name.ends_with(".exe"), "macOS sidecar must not end with .exe");
            assert!(name.contains("darwin"), "macOS sidecar must contain 'darwin', got: {name}");
        } else {
            assert!(!name.ends_with(".exe"), "Linux sidecar must not end with .exe");
            assert!(name.contains("linux"), "Linux sidecar must contain 'linux', got: {name}");
        }
    }

    #[test]
    fn resolve_node_binary_falls_back_to_system_node_when_no_sidecar() {
        let dir = std::env::temp_dir().join("bandsearch_test_no_sidecar");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let binary = resolve_node_binary_in(&dir);
        assert_eq!(binary, "node", "should fall back to system node when sidecar absent");
    }

    #[test]
    fn resolve_node_binary_returns_sidecar_path_when_binary_exists() {
        let dir = std::env::temp_dir().join("bandsearch_test_sidecar");
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let sidecar = dir.join(sidecar_name());
        std::fs::write(&sidecar, b"").expect("write dummy sidecar");
        let binary = resolve_node_binary_in(&dir);
        assert_eq!(
            binary,
            sidecar.to_string_lossy(),
            "should return the sidecar path when binary exists",
        );
        let _ = std::fs::remove_file(&sidecar);
    }

    #[test]
    fn tauri_conf_has_external_bin_for_node_sidecar() {
        let conf = include_str!("../tauri.conf.json");
        let parsed: serde_json::Value =
            serde_json::from_str(conf).expect("tauri.conf.json must be valid JSON");
        let external_bin = parsed["bundle"]["externalBin"]
            .as_array()
            .expect("bundle.externalBin must be an array");
        assert!(
            external_bin.iter().any(|e| e.as_str() == Some("binaries/node")),
            "bundle.externalBin must contain 'binaries/node'",
        );
    }

    #[test]
    fn tauri_conf_enables_updater_artifacts_and_pubkey() {
        let conf = include_str!("../tauri.conf.json");
        let parsed: serde_json::Value =
            serde_json::from_str(conf).expect("tauri.conf.json must be valid JSON");
        assert_eq!(
            parsed["bundle"]["createUpdaterArtifacts"].as_bool(),
            Some(true),
            "bundle.createUpdaterArtifacts must be true for signed releases",
        );
        let pubkey = parsed["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("plugins.updater.pubkey must be a string");
        assert!(!pubkey.trim().is_empty(), "plugins.updater.pubkey must not be empty");
        let endpoints = parsed["plugins"]["updater"]["endpoints"]
            .as_array()
            .expect("plugins.updater.endpoints must be an array");
        assert!(
            endpoints.iter().any(|e| e
                .as_str()
                .is_some_and(|u| u.contains("releases/latest/download/latest.json"))),
            "plugins.updater.endpoints must include GitHub latest.json",
        );
    }

    #[test]
    fn resolve_workspace_root_from_finds_repo_from_cargo_manifest_dir() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root = resolve_workspace_root_from(&manifest_dir).expect("repo root next to this crate");
        assert!(
            root.join("services").join("api").join("src").join("server.ts").is_file(),
            "expected services/api/src/server.ts under {:?}",
            root
        );
    }

    #[test]
    fn env_non_empty_true_when_var_set() {
        let key = "BANDSEARCH_TEST_ENV_NON_EMPTY_SET";
        std::env::set_var(key, "value");
        assert!(env_non_empty(key));
        std::env::remove_var(key);
    }

    #[test]
    fn env_non_empty_false_when_var_absent() {
        let key = "BANDSEARCH_TEST_ENV_NON_EMPTY_ABSENT";
        std::env::remove_var(key);
        assert!(!env_non_empty(key));
    }

    #[test]
    fn env_non_empty_false_when_var_whitespace() {
        let key = "BANDSEARCH_TEST_ENV_NON_EMPTY_WS";
        std::env::set_var(key, "   ");
        assert!(!env_non_empty(key));
        std::env::remove_var(key);
    }

    #[test]
    fn should_run_local_sidecar_true_when_endpoint_blank() {
        assert!(should_run_local_sidecar(""));
    }

    #[test]
    fn should_run_local_sidecar_true_when_endpoint_whitespace() {
        assert!(should_run_local_sidecar("   "));
    }

    #[test]
    fn should_run_local_sidecar_false_when_endpoint_set() {
        assert!(!should_run_local_sidecar("https://bandsearch.onrender.com"));
    }

    #[test]
    fn is_valid_http_url_accepts_http_and_https() {
        assert!(is_valid_http_url("http://localhost:3001"));
        assert!(is_valid_http_url("https://bandsearch.onrender.com"));
        assert!(is_valid_http_url("  https://example.com  "));
    }

    #[test]
    fn is_valid_http_url_rejects_non_http_and_empty() {
        assert!(!is_valid_http_url(""));
        assert!(!is_valid_http_url("   "));
        assert!(!is_valid_http_url("ftp://example.com"));
        assert!(!is_valid_http_url("javascript:alert(1)"));
        assert!(!is_valid_http_url("http://"));
        assert!(!is_valid_http_url("https://"));
        assert!(!is_valid_http_url("bandsearch.onrender.com"));
    }

    #[test]
    fn config_defaults_api_endpoint_url_to_empty_when_absent() {
        // Older config.json files predate the field; serde(default) must keep them valid.
        let cfg: BandsearchConfig = serde_json::from_str(r#"{"gemini_api_key":"k"}"#)
            .expect("config without api_endpoint_url must still parse");
        assert_eq!(cfg.api_endpoint_url, "");
        assert!(should_run_local_sidecar(&cfg.api_endpoint_url));
    }

    #[test]
    fn config_round_trips_api_endpoint_url() {
        let cfg: BandsearchConfig =
            serde_json::from_str(r#"{"api_endpoint_url":"https://remote.example"}"#)
                .expect("config with api_endpoint_url must parse");
        assert_eq!(cfg.api_endpoint_url, "https://remote.example");
        assert!(!should_run_local_sidecar(&cfg.api_endpoint_url));
    }

    #[test]
    fn gemini_config_status_serializes_api_endpoint_url_camel_case() {
        let status = GeminiConfigStatus {
            has_stored_key: false,
            has_brave_key: false,
            onboarding_complete: false,
            has_turso_config: false,
            gemini_key_from_env: false,
            brave_key_from_env: false,
            turso_from_env: false,
            api_endpoint_url: "https://remote.example".to_string(),
        };
        let value = serde_json::to_value(&status).expect("status must serialize");
        assert_eq!(value["apiEndpointUrl"], "https://remote.example");
    }
}
