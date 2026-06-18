mod commands;
mod error;
mod runtime;
mod services;

use commands::{
    app_environment_snapshot, app_snapshot, explorer_list_directory, providers_config_paths,
    providers_refresh, providers_save_remote, providers_select_remote, providers_snapshot,
    providers_test_remote, proxy_snapshot, settings_save, settings_snapshot, shortcuts_save,
    shortcuts_snapshot, transfers_delete_all, transfers_delete_selected, transfers_snapshot,
};
use runtime::MistyRuntime;

fn main() {
    tauri::Builder::default()
        .manage(MistyRuntime::new())
        .invoke_handler(tauri::generate_handler![
            app_snapshot,
            app_environment_snapshot,
            proxy_snapshot,
            explorer_list_directory,
            settings_snapshot,
            settings_save,
            shortcuts_snapshot,
            shortcuts_save,
            providers_snapshot,
            providers_refresh,
            providers_select_remote,
            providers_save_remote,
            providers_test_remote,
            providers_config_paths,
            transfers_snapshot,
            transfers_delete_selected,
            transfers_delete_all,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Misty Tauri app");
}
