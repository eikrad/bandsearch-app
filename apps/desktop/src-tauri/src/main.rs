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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiConfigStatus {
    has_stored_key: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveGeminiApiKeyRequest {
    api_key: String,
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

fn persist_gemini_key(key: &str) -> Result<(), String> {
    let path = config_file_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut cfg = load_config();
    cfg.gemini_api_key = key.to_string();
    let data = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

fn gemini_key_for_spawn() -> Option<String> {
    let cfg = load_config();
    let trimmed = cfg.gemini_api_key.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
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

fn api_spawn_args(workspace_root: &Path) -> (String, Vec<String>) {
    let server_path = workspace_root
        .join("services")
        .join("api")
        .join("src")
        .join("server.js");
    (
        "node".to_string(),
        vec![server_path.to_string_lossy().into_owned()],
    )
}

fn spawn_api_child(workspace_root: &Path, gemini_key: Option<&str>) -> Result<Child, std::io::Error> {
    let (binary, args) = api_spawn_args(workspace_root);
    let mut cmd = Command::new(&binary);
    cmd.args(&args).current_dir(workspace_root);
    if let Some(k) = gemini_key {
        let t = k.trim();
        if !t.is_empty() {
            cmd.env("GEMINI_API_KEY", t);
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

fn start_api_sidecar(api: &ApiProcess, workspace_root: &Path, gemini_key: Option<&str>) {
    match spawn_api_child(workspace_root, gemini_key) {
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

fn restart_api_sidecar(api: &ApiProcess, workspace_root: &Path, gemini_key: Option<&str>) {
    if let Ok(mut guard) = api.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
    start_api_sidecar(api, workspace_root, gemini_key);
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
    persist_gemini_key(trimmed)?;
    restart_api_sidecar(api.inner(), &workspace.0, Some(trimmed));
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![gemini_config_status, save_gemini_api_key])
        .setup(|app| {
            let menu = build_app_menu(&app.handle())?;
            app.set_menu(menu)?;

            let exe = std::env::current_exe()?;
            let workspace_root = if cfg!(debug_assertions) {
                exe.ancestors().nth(6).unwrap_or(&exe).to_path_buf()
            } else {
                std::env::current_dir()?
            };
            eprintln!("[bandsearch] workspace_root: {}", workspace_root.display());

            let api = ApiProcess(Mutex::new(None));
            let gemini = gemini_key_for_spawn();
            start_api_sidecar(&api, &workspace_root, gemini.as_deref());

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
        assert_eq!(args.len(), 1);
        assert!(
            args[0].ends_with("services/api/src/server.js"),
            "expected server.js path, got: {}",
            args[0]
        );
    }

    #[test]
    fn api_spawn_args_binary_is_node() {
        let root = PathBuf::from("/any/root");
        let (binary, _) = api_spawn_args(&root);
        assert_eq!(binary, "node");
    }
}
