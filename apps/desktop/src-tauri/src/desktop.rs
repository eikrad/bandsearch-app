//! Desktop-only shell: app menu, updater, local Node sidecar lifecycle.
//! Compiled only under `cfg(desktop)` (see `lib.rs`).

use crate::{
    absolute_bandsearch_db_path, load_dotenv, reconcile_sidecar, resolve_workspace_root,
    stop_api_sidecar, ApiProcess, WorkspaceRoot,
};
use serde::Serialize;
use std::sync::Mutex;
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, WindowEvent, Wry};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAvailablePayload {
    pub(crate) version: String,
    pub(crate) can_auto_install: bool,
}

/// Whether this build can install an update in place. macOS ships no signed
/// updater artifact (see the auto-update plan's deviations), so its banner is
/// informational only. Single source of truth for the payload and its test.
pub(crate) fn can_auto_install() -> bool {
    cfg!(not(target_os = "macos"))
}

/// Checks the configured updater endpoint once and, on a hit, emits `update-available`
/// with the new version and whether this platform can auto-install it.
async fn check_for_update_and_notify(app: AppHandle) {
    let Ok(updater) = app.updater() else {
        eprintln!("[bandsearch] updater unavailable");
        return;
    };
    match updater.check().await {
        Ok(Some(update)) => {
            let payload = UpdateAvailablePayload {
                version: update.version,
                can_auto_install: can_auto_install(),
            };
            if let Err(e) = app.emit("update-available", payload) {
                eprintln!("[bandsearch] failed to emit update-available: {e}");
            }
        }
        Ok(None) => {}
        Err(e) => eprintln!("[bandsearch] update check failed: {e}"),
    }
}

fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let quit = PredefinedMenuItem::quit(app, Some("Quit Bandsearch"))?;
    let about = PredefinedMenuItem::about(app, Some("About Bandsearch"), None)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let app_submenu = Submenu::with_items(app, "Bandsearch", true, &[&about, &separator, &quit])?;
    Menu::with_items(app, &[&app_submenu])
}

/// Re-checks for an update (rather than trusting the earlier `update-available` event)
/// so install always acts on a fresh, signature-verified release.
#[tauri::command]
pub(crate) async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())
}

/// Desktop plugins and window hooks.
pub(crate) fn configure(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    if let Some(state) = window.try_state::<ApiProcess>() {
                        stop_api_sidecar(&state);
                    }
                }
            }
        })
}

/// Desktop part of `setup`: menu, update check, local sidecar.
pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let menu = build_app_menu(app.handle())?;
    app.set_menu(menu)?;

    let workspace_root = resolve_workspace_root();
    load_dotenv(&workspace_root);
    eprintln!("[bandsearch] workspace_root: {}", workspace_root.display());
    eprintln!(
        "[bandsearch] DATABASE_PATH: {}",
        absolute_bandsearch_db_path(&workspace_root)
    );

    // Spawned before reconcile_sidecar, which blocks this thread in
    // wait_for_api_tcp for as long as the Node sidecar takes to listen.
    tauri::async_runtime::spawn(check_for_update_and_notify(app.handle().clone()));

    let api = ApiProcess(Mutex::new(None));
    // Start the local sidecar only when no remote endpoint is configured.
    reconcile_sidecar(&api, &workspace_root);

    app.manage(api);
    app.manage(WorkspaceRoot(workspace_root));
    Ok(())
}

/// Reconciles the sidecar with the stored config after a settings change.
pub(crate) fn reconcile_sidecar_for(app: &AppHandle) {
    let (Some(api), Some(workspace)) = (app.try_state::<ApiProcess>(), app.try_state::<WorkspaceRoot>())
    else {
        return;
    };
    reconcile_sidecar(api.inner(), &workspace.0);
}
