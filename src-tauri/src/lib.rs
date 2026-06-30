#![allow(dead_code, unused_imports, unused_variables)]

mod commands;
mod core;
mod error;
mod plugins;
mod runtime;
mod services;

use commands::{
    ai_abort, ai_drain_events, ai_send_message, ai_status, app_environment_snapshot, app_snapshot,
    archive_create, archive_extract, archive_list, automation_rules_delete,
    automation_rules_run_now, automation_rules_save, automation_rules_snapshot,
    automation_watch_snapshot, automation_watch_start, automation_watch_stop, claude_abort,
    claude_drain_events, claude_send_message, claude_status, clipboard_apply_shared,
    clipboard_native_file_refs, clipboard_publish_image_bytes, clipboard_publish_shared,
    clipboard_set_local, clipboard_shared_image_bytes, clipboard_snapshot,
    clipboard_write_file_refs, compare_apply_text_merge, compare_files, compare_folders,
    devices_snapshot, duplicates_cancel, duplicates_hash_remote_candidates, duplicates_scan,
    explorer_calculate_directory_sizes, explorer_create_item, explorer_delete_items,
    explorer_directory_size_snapshot, explorer_library_record_last_opened,
    explorer_library_record_recent, explorer_library_set_tags, explorer_library_snapshot,
    explorer_list_directory, explorer_open_association, explorer_open_path, explorer_open_with,
    explorer_paste_items, explorer_path_exists, explorer_path_is_directory,
    explorer_prepare_drag_items, explorer_prepare_open_item, explorer_preview_item,
    explorer_queue_create_item, explorer_queue_delete_items, explorer_queue_paste_blob,
    explorer_queue_paste_items, explorer_queue_paste_text, explorer_queue_rename_item,
    explorer_queue_rename_items, explorer_rename_item, explorer_set_open_association,
    file_metadata_snapshot, file_sync_apply, file_sync_compare, file_sync_pair_remove,
    file_sync_pair_save, file_sync_pairs_snapshot, file_tools_checksum, file_tools_chmod,
    file_tools_create_symlink, file_tools_read_symlink, file_tools_set_readonly,
    open_terminal_at_path, operation_queue_cancel, operation_queue_cancel_batch,
    operation_queue_clear_terminal, operation_queue_pause, operation_queue_pause_all,
    operation_queue_pause_batch, operation_queue_redo, operation_queue_resolve_conflict,
    operation_queue_resume, operation_queue_resume_all, operation_queue_resume_batch,
    operation_queue_retry, operation_queue_set_bandwidth_limit, operation_queue_set_priority,
    operation_queue_set_transfer_profile, operation_queue_snapshot, operation_queue_undo,
    plugin_command_run, plugin_commands_snapshot, plugin_diagnostics_snapshot, plugin_panel_render,
    providers_backend_actions, providers_config_paths, providers_config_security,
    providers_configure_remote, providers_create_public_link, providers_disconnect_remote,
    providers_harden_config, providers_job_cancel, providers_job_status, providers_public_links,
    providers_refresh, providers_repair_config_security, providers_revoke_public_link,
    providers_run_backend_action, providers_save_remote, providers_select_remote,
    providers_snapshot, providers_test_remote, providers_verify_result, providers_verify_start,
    proxy_snapshot, saved_searches_delete, saved_searches_save, saved_searches_snapshot,
    search_cancel_scan, search_get_status, search_init, search_query, search_start_scan,
    settings_apply_launch_on_login, settings_launch_on_login_snapshot,
    settings_open_with_associations, settings_remove_open_with_association, settings_save,
    settings_snapshot, shortcuts_save, shortcuts_snapshot, transfers_delete_all,
    transfers_delete_selected, transfers_snapshot, workspaces_save, workspaces_snapshot,
};
use plugins::mac_rounded_corners;
use runtime::MistyRuntime;
use services::hub::{
    check_system, ensure_local_access_token, ensure_misty_folders, get_clipboard_proxy_snapshot,
    get_misty_process_status, install_misty, install_plugin_bundle, launch_misty,
    open_external_url, probe_paths, read_misty_log, restart_misty, save_authenticated_user,
    save_verified_license, scan_local_plugins, set_plugin_enabled, sign_out_misty, stop_misty,
    uninstall_plugin,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keystore::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(MistyRuntime::new())
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            let tauri::WindowEvent::Resized(size) = event else {
                return;
            };

            let Some(webview) = window
                .webviews()
                .into_iter()
                .find(|webview| webview.label() == "main")
            else {
                return;
            };

            let _ = webview.set_bounds(tauri::Rect {
                position: tauri::Position::Physical(tauri::PhysicalPosition::new(0, 0)),
                size: tauri::Size::Physical(*size),
            });
        })
        .invoke_handler(tauri::generate_handler![
            mac_rounded_corners::enable_rounded_corners,
            mac_rounded_corners::enable_modern_window_style,
            mac_rounded_corners::enable_custom_titlebar_window_style,
            mac_rounded_corners::reposition_traffic_lights,
            app_snapshot,
            app_environment_snapshot,
            ai_status,
            ai_send_message,
            ai_drain_events,
            ai_abort,
            claude_status,
            claude_send_message,
            claude_drain_events,
            claude_abort,
            check_system,
            ensure_misty_folders,
            probe_paths,
            ensure_local_access_token,
            save_authenticated_user,
            save_verified_license,
            sign_out_misty,
            install_misty,
            launch_misty,
            restart_misty,
            stop_misty,
            scan_local_plugins,
            install_plugin_bundle,
            set_plugin_enabled,
            uninstall_plugin,
            get_clipboard_proxy_snapshot,
            get_misty_process_status,
            read_misty_log,
            open_external_url,
            proxy_snapshot,
            clipboard_snapshot,
            clipboard_set_local,
            clipboard_publish_shared,
            clipboard_publish_image_bytes,
            clipboard_apply_shared,
            clipboard_shared_image_bytes,
            clipboard_native_file_refs,
            clipboard_write_file_refs,
            devices_snapshot,
            explorer_list_directory,
            explorer_directory_size_snapshot,
            explorer_calculate_directory_sizes,
            explorer_create_item,
            explorer_rename_item,
            explorer_delete_items,
            explorer_paste_items,
            explorer_prepare_open_item,
            explorer_prepare_drag_items,
            explorer_preview_item,
            file_metadata_snapshot,
            search_init,
            search_get_status,
            search_start_scan,
            search_cancel_scan,
            search_query,
            explorer_open_path,
            explorer_open_with,
            explorer_open_association,
            explorer_set_open_association,
            explorer_path_is_directory,
            explorer_path_exists,
            explorer_library_snapshot,
            explorer_library_record_recent,
            explorer_library_record_last_opened,
            explorer_library_set_tags,
            explorer_queue_create_item,
            explorer_queue_rename_item,
            explorer_queue_rename_items,
            explorer_queue_delete_items,
            explorer_queue_paste_items,
            explorer_queue_paste_text,
            explorer_queue_paste_blob,
            file_sync_pairs_snapshot,
            file_sync_pair_save,
            file_sync_pair_remove,
            file_sync_compare,
            file_sync_apply,
            workspaces_snapshot,
            workspaces_save,
            settings_snapshot,
            settings_save,
            settings_launch_on_login_snapshot,
            settings_apply_launch_on_login,
            settings_open_with_associations,
            settings_remove_open_with_association,
            shortcuts_snapshot,
            shortcuts_save,
            plugin_commands_snapshot,
            plugin_command_run,
            plugin_panel_render,
            plugin_diagnostics_snapshot,
            providers_snapshot,
            providers_refresh,
            providers_select_remote,
            providers_save_remote,
            providers_test_remote,
            providers_config_paths,
            providers_configure_remote,
            providers_verify_start,
            providers_job_status,
            providers_job_cancel,
            providers_verify_result,
            providers_public_links,
            providers_create_public_link,
            providers_revoke_public_link,
            providers_backend_actions,
            providers_run_backend_action,
            providers_config_security,
            providers_harden_config,
            providers_repair_config_security,
            providers_disconnect_remote,
            transfers_snapshot,
            transfers_delete_selected,
            transfers_delete_all,
            open_terminal_at_path,
            operation_queue_snapshot,
            operation_queue_cancel,
            operation_queue_cancel_batch,
            operation_queue_retry,
            operation_queue_pause,
            operation_queue_resume,
            operation_queue_pause_batch,
            operation_queue_resume_batch,
            operation_queue_pause_all,
            operation_queue_resume_all,
            operation_queue_set_priority,
            operation_queue_set_bandwidth_limit,
            operation_queue_set_transfer_profile,
            operation_queue_undo,
            operation_queue_redo,
            operation_queue_resolve_conflict,
            operation_queue_clear_terminal,
            archive_list,
            archive_create,
            archive_extract,
            duplicates_scan,
            duplicates_cancel,
            duplicates_hash_remote_candidates,
            saved_searches_snapshot,
            saved_searches_save,
            saved_searches_delete,
            compare_files,
            compare_folders,
            compare_apply_text_merge,
            file_tools_checksum,
            file_tools_set_readonly,
            file_tools_chmod,
            file_tools_create_symlink,
            file_tools_read_symlink,
            automation_rules_snapshot,
            automation_rules_save,
            automation_rules_delete,
            automation_rules_run_now,
            automation_watch_snapshot,
            automation_watch_start,
            automation_watch_stop,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Misty Tauri app");
}
