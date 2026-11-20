// The app's own IPC commands: the one list of them. `main.rs` registers exactly
// these with `generate_handler!`; anything else that needs the command names
// (a permission per command, a test) reads them from here too.

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
