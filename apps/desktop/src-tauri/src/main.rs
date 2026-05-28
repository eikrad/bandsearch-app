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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiConfigStatus {
    has_stored_key: bool,
    has_brave_key: bool,
    onboarding_complete: bool,
    has_turso_config: bool,
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
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
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
        .join("server.js");
    (
        resolve_node_binary(),
        vec![
            "--import".to_string(),
            "tsx".to_string(),
            server_path.to_string_lossy().into_owned(),
        ],
    )
}

/// Walk up from `start` until we find the repo root that contains `services/api/src/server.js`.
fn resolve_workspace_root_from(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let server_js = ancestor
            .join("services")
            .join("api")
            .join("src")
            .join("server.js");
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
) -> Result<Child, std::io::Error> {
    let (binary, args) = api_spawn_args(workspace_root);
    let mut cmd = Command::new(&binary);
    cmd.args(&args).current_dir(workspace_root);
    cmd.env("DATABASE_PATH", absolute_bandsearch_db_path(workspace_root));
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
) {
    match spawn_api_child(workspace_root, gemini_key, brave_key, turso_url, turso_token) {
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

fn restart_api_sidecar(
    api: &ApiProcess,
    workspace_root: &Path,
    gemini_key: Option<&str>,
    brave_key: Option<&str>,
    turso_url: Option<&str>,
    turso_token: Option<&str>,
) {
    if let Ok(mut guard) = api.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
    start_api_sidecar(api, workspace_root, gemini_key, brave_key, turso_url, turso_token);
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
    Ok(GeminiConfigStatus {
        has_stored_key: !cfg.gemini_api_key.trim().is_empty(),
        has_brave_key: !cfg.brave_api_key.trim().is_empty(),
        onboarding_complete: cfg.onboarding_completed,
        has_turso_config: !cfg.turso_database_url.trim().is_empty(),
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
    let brave = brave_key_for_spawn();
    let (turso_url, turso_tok) = turso_for_spawn();
    restart_api_sidecar(api.inner(), &workspace.0, Some(trimmed), brave.as_deref(), turso_url.as_deref(), turso_tok.as_deref());
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
    let gemini = gemini_key_for_spawn();
    let (turso_url, turso_tok) = turso_for_spawn();
    restart_api_sidecar(api.inner(), &workspace.0, gemini.as_deref(), Some(trimmed), turso_url.as_deref(), turso_tok.as_deref());
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
    let gemini = gemini_key_for_spawn();
    let brave = brave_key_for_spawn();
    restart_api_sidecar(api.inner(), &workspace.0, gemini.as_deref(), brave.as_deref(), Some(url), Some(cfg.turso_auth_token.as_str()));
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
        .invoke_handler(tauri::generate_handler![gemini_config_status, save_gemini_api_key, save_brave_api_key, save_turso_config, complete_onboarding])
        .setup(|app| {
            let menu = build_app_menu(&app.handle())?;
            app.set_menu(menu)?;

            let workspace_root = resolve_workspace_root();
            eprintln!("[bandsearch] workspace_root: {}", workspace_root.display());
            eprintln!(
                "[bandsearch] DATABASE_PATH: {}",
                absolute_bandsearch_db_path(&workspace_root)
            );

            let api = ApiProcess(Mutex::new(None));
            let gemini = gemini_key_for_spawn();
            let brave = brave_key_for_spawn();
            let (turso_url, turso_tok) = turso_for_spawn();
            start_api_sidecar(&api, &workspace_root, gemini.as_deref(), brave.as_deref(), turso_url.as_deref(), turso_tok.as_deref());

            app.manage(api);
            app.manage(WorkspaceRoot(workspace_root));

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    if let Some(state) = window.try_state::<ApiProcess>() {
                        if let Ok(mut guard) = state.0.lock() {
                            if let Some(mut child) = guard.take() {
                                let _ = child.kill();
                            }
                        }
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
            args[2].ends_with("services/api/src/server.js"),
            "expected server.js path, got: {}",
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
    fn resolve_workspace_root_from_finds_repo_from_cargo_manifest_dir() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root = resolve_workspace_root_from(&manifest_dir).expect("repo root next to this crate");
        assert!(
            root.join("services").join("api").join("src").join("server.js").is_file(),
            "expected services/api/src/server.js under {:?}",
            root
        );
    }
}
