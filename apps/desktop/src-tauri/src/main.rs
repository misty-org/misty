mod commands;
mod core;
mod error;
mod runtime;
mod services;

use commands::{
    app_environment_snapshot, app_snapshot, clipboard_set_local, clipboard_snapshot,
    explorer_create_item, explorer_delete_items, explorer_list_directory,
    explorer_open_association, explorer_open_with, explorer_paste_items, explorer_path_exists,
    explorer_path_is_directory, explorer_prepare_open_item, explorer_queue_create_item,
    explorer_queue_delete_items, explorer_queue_paste_items, explorer_queue_paste_text,
    explorer_queue_rename_item, explorer_queue_rename_items, explorer_rename_item,
    explorer_set_open_association, file_sync_apply, file_sync_compare, file_sync_pair_remove,
    file_sync_pair_save, file_sync_pairs_snapshot, operation_queue_cancel,
    operation_queue_clear_terminal, operation_queue_resolve_conflict, operation_queue_retry,
    operation_queue_snapshot, providers_config_paths, providers_refresh, providers_save_remote,
    providers_select_remote, providers_snapshot, providers_test_remote, proxy_snapshot,
    settings_open_with_associations, settings_remove_open_with_association, settings_save,
    settings_snapshot, shortcuts_save, shortcuts_snapshot, transfers_delete_all,
    transfers_delete_selected, transfers_snapshot, workspaces_save, workspaces_snapshot,
};
use runtime::MistyRuntime;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(MistyRuntime::new())
        .invoke_handler(tauri::generate_handler![
            app_snapshot,
            app_environment_snapshot,
            proxy_snapshot,
            clipboard_snapshot,
            clipboard_set_local,
            explorer_list_directory,
            explorer_create_item,
            explorer_rename_item,
            explorer_delete_items,
            explorer_paste_items,
            explorer_prepare_open_item,
            explorer_open_with,
            explorer_open_association,
            explorer_set_open_association,
            explorer_path_is_directory,
            explorer_path_exists,
            explorer_queue_create_item,
            explorer_queue_rename_item,
            explorer_queue_rename_items,
            explorer_queue_delete_items,
            explorer_queue_paste_items,
            explorer_queue_paste_text,
            file_sync_pairs_snapshot,
            file_sync_pair_save,
            file_sync_pair_remove,
            file_sync_compare,
            file_sync_apply,
            workspaces_snapshot,
            workspaces_save,
            settings_snapshot,
            settings_save,
            settings_open_with_associations,
            settings_remove_open_with_association,
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
            operation_queue_snapshot,
            operation_queue_cancel,
            operation_queue_retry,
            operation_queue_resolve_conflict,
            operation_queue_clear_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Misty Tauri app");
}
