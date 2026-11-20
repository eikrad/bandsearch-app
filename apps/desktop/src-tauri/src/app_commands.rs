// The app's own IPC commands: the one list of them. `main.rs` registers exactly
// these with `generate_handler!`, and `build.rs` (which includes this file) hands
// the same names to `tauri_build::AppManifest::commands`, which generates an
// `allow-<name>` permission for each. Tauri rejects an app command whose
// permission is not granted, so the build fails when `capabilities/default.json`
// does not grant one.
//
// Adding a command: write the `#[tauri::command]` fn, add its name below, and add
// `"allow-<name-with-dashes>"` to `capabilities/default.json`. Then build once and
// commit the regenerated `gen/schemas/`.

/// Calls the macro `$then!` with the app's command names, so a `generate_handler!`
/// and a list of names can both be produced from this one list.
macro_rules! app_commands {
    ($then:ident) => {
        $then![
            llm_config_status,
            save_llm_api_key,
            save_brave_api_key,
            save_turso_config,
            clear_turso_config,
            save_api_endpoint_url,
            complete_onboarding,
            install_update,
        ]
    };
}

/// Turns a list of command idents into their names, for `app_commands!`.
#[allow(unused_macros)]
macro_rules! command_names {
    ($($command:ident),* $(,)?) => {
        &[$(stringify!($command)),*]
    };
}
