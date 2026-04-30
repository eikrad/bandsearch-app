#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{Manager, WindowEvent};

struct ApiProcess(Mutex<Option<Child>>);

fn api_spawn_args(workspace_root: &PathBuf) -> (String, Vec<String>) {
    let server_path = workspace_root
        .join("services")
        .join("api")
        .join("src")
        .join("server.js");
    ("node".to_string(), vec![server_path.to_string_lossy().into_owned()])
}

fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let quit = PredefinedMenuItem::quit(app, Some("Quit Bandsearch"))?;
    let about = PredefinedMenuItem::about(app, Some("About Bandsearch"), None)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let app_submenu = Submenu::with_items(app, "Bandsearch", true, &[&about, &separator, &quit])?;
    Menu::with_items(app, &[&app_submenu])
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let menu = build_app_menu(&app.handle())?;
            app.set_menu(menu)?;

            // Resolve workspace root.
            // dev exe: <workspace>/apps/desktop/src-tauri/target/debug/bandsearch
            // ancestors: nth(0)=exe, nth(1)=debug/, nth(2)=target/, nth(3)=src-tauri/,
            //            nth(4)=apps/desktop/, nth(5)=apps/, nth(6)=<workspace>/
            let exe = std::env::current_exe()?;
            let workspace_root = if cfg!(debug_assertions) {
                exe.ancestors().nth(6).unwrap_or(&exe).to_path_buf()
            } else {
                std::env::current_dir()?
            };
            eprintln!("[bandsearch] workspace_root: {}", workspace_root.display());

            let (binary, args) = api_spawn_args(&workspace_root);
            match Command::new(&binary).args(&args).current_dir(&workspace_root).spawn() {
                Ok(child) => {
                    app.manage(ApiProcess(Mutex::new(Some(child))));
                }
                Err(e) => {
                    eprintln!("failed to start API process: {e}");
                    app.manage(ApiProcess(Mutex::new(None)));
                }
            }

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
