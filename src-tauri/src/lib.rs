#![allow(dead_code, unused_imports, unused_variables)]

mod commands;
mod core;
mod error;
#[cfg(desktop)]
mod extension_protocol;
mod plugins;
mod runtime;
mod services;
mod telemetry;

#[cfg(desktop)]
use commands::{
    agents_device_identity_load, agents_device_identity_store,
    media_search_acknowledge_removed_assets, media_search_approve_assets, media_search_complete,
    media_search_complete_legacy_adoption, media_search_prepare_chunk, media_search_record_chunk,
    media_search_reset_device_index, media_search_resolve_assets, media_search_scan_movies,
    media_search_set_asset_state, media_search_snapshot,
};
use commands::{
    agents_device_snapshot, agents_open_citation, agents_prepare_document,
    agents_prepare_scoped_document, agents_register_folder_scope, app_environment_snapshot,
    app_snapshot, archive_create, archive_extract, archive_list, claude_abort, claude_drain_events,
    claude_send_message, claude_status, clipboard_apply_shared, clipboard_native_file_refs,
    clipboard_publish_image_bytes, clipboard_publish_shared, clipboard_set_local,
    clipboard_shared_image_bytes, clipboard_snapshot, clipboard_write_file_bytes,
    clipboard_write_file_refs, compare_apply_text_merge, compare_files, compare_folders,
    devices_snapshot, duplicates_cancel, duplicates_hash_remote_candidates, duplicates_scan,
    explorer_calculate_directory_sizes, explorer_cancel_drag_preparation, explorer_create_item,
    explorer_delete_items, explorer_directory_size_snapshot, explorer_generate_image_thumbnail,
    explorer_library_record_last_opened, explorer_library_record_recent, explorer_library_set_tags,
    explorer_library_snapshot, explorer_list_directory, explorer_open_association,
    explorer_open_path, explorer_open_with, explorer_paste_items, explorer_path_exists,
    explorer_path_is_directory, explorer_prepare_drag_items, explorer_prepare_open_item,
    explorer_preview_item, explorer_queue_create_item, explorer_queue_delete_items,
    explorer_queue_paste_blob, explorer_queue_paste_items, explorer_queue_paste_text,
    explorer_queue_rename_item, explorer_queue_rename_items, explorer_rename_item,
    explorer_save_preview_item, explorer_set_open_association, extension_command_run,
    file_metadata_snapshot, file_sync_apply, file_sync_compare, file_sync_pair_remove,
    file_sync_pair_save, file_sync_pairs_snapshot, file_tools_checksum, file_tools_chmod,
    file_tools_create_symlink, file_tools_read_symlink, file_tools_set_readonly, notes_store_asset,
    open_terminal_at_path, operation_queue_cancel, operation_queue_cancel_batch,
    operation_queue_clear_terminal, operation_queue_pause, operation_queue_pause_all,
    operation_queue_pause_batch, operation_queue_redo, operation_queue_resolve_conflict,
    operation_queue_resume, operation_queue_resume_all, operation_queue_resume_batch,
    operation_queue_retry, operation_queue_retry_transfer, operation_queue_set_bandwidth_limit,
    operation_queue_set_transfer_profile, operation_queue_snapshot, operation_queue_undo,
    plugin_command_run, plugin_commands_snapshot, plugin_diagnostics_snapshot, plugin_panel_render,
    providers_backend_actions, providers_config_paths, providers_config_security,
    providers_configure_remote, providers_disconnect_remote, providers_harden_config,
    providers_import_cloud_connection, providers_job_cancel, providers_job_status,
    providers_refresh, providers_repair_config_security, providers_run_backend_action,
    providers_save_remote, providers_select_remote, providers_snapshot, providers_test_remote,
    providers_verify_result, providers_verify_start, saved_searches_delete, saved_searches_save,
    saved_searches_snapshot, search_cancel_scan, search_get_status, search_init, search_query,
    search_start_scan, settings_apply_launch_on_login, settings_launch_on_login_snapshot,
    settings_open_with_associations, settings_remove_open_with_association, settings_save,
    settings_snapshot, shortcuts_save, shortcuts_snapshot, smart_library_apply_results,
    smart_library_assets_page, smart_library_delete, smart_library_import_files,
    smart_library_preflight_import, smart_library_prepare_previews, smart_library_resolve_assets,
    smart_library_scan, smart_library_search, smart_library_set_server_folder_id,
    smart_library_snapshot, storage_snapshot, transfers_delete_all, transfers_delete_selected,
    transfers_snapshot, workspaces_save, workspaces_snapshot,
};
#[cfg(target_os = "android")]
use commands::{
    android_all_files_access_status, android_grant_local_folder,
    android_open_all_files_access_settings,
};
use plugins::mac_rounded_corners;
use runtime::MistyRuntime;
use services::misty::{
    check_system, ensure_local_access_token, fetch_misty_releases, get_misty_process_status,
    install_plugin_bundle, launch_misty, open_external_url, probe_paths, restart_misty,
    save_authenticated_user, save_verified_license, scan_local_plugins, set_plugin_enabled,
    sign_out_misty, stop_misty, uninstall_plugin,
};
use services::misty_template::{
    build_misty_template, install_misty_template, misty_template_status, restart_misty_app,
};
#[cfg(desktop)]
use services::tray;
use tauri::Manager;
use telemetry::TelemetryReporter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    telemetry::initialize();
    let builder = tauri::Builder::default();

    // Register this first so duplicate launches are rejected before any other
    // plugin or application service can initialize a second Misty runtime.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app
            .get_webview_window("main")
            .or_else(|| app.webview_windows().into_values().next())
        {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_drag::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_document_tree::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keystore::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            #[cfg(any(target_os = "ios", target_os = "android"))]
            let runtime = {
                let data_root = app
                    .path()
                    .app_data_dir()
                    .ok()
                    .map(|path| path.join("Misty"));
                if let Some(root) = &data_root {
                    services::paths::set_mobile_data_root(root.clone());
                }
                MistyRuntime::new_with_data_root(data_root)
            };
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            let runtime = MistyRuntime::new();
            app.manage(runtime);
            #[cfg(desktop)]
            if let Err(error) = tray::setup(app) {
                let error = std::io::Error::other(error);
                telemetry::PostHogTelemetryReporter
                    .capture_error(&error, telemetry::SafeOperation::ApplicationStartup);
                return Err(error.into());
            }
            #[cfg(target_os = "macos")]
            services::devices::start_device_change_listener(app.handle().clone());
            Ok(())
        });

    #[cfg(desktop)]
    let builder =
        builder.register_uri_scheme_protocol("misty-extension", extension_protocol::handle);

    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        tray::handle_menu_event(app, event.id().as_ref());
    });

    builder
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            {
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
            }
        })
        .invoke_handler(tauri::generate_handler![
            mac_rounded_corners::enable_rounded_corners,
            mac_rounded_corners::enable_modern_window_style,
            mac_rounded_corners::enable_custom_titlebar_window_style,
            mac_rounded_corners::reposition_traffic_lights,
            mac_rounded_corners::set_native_wallpaper_video,
            app_snapshot,
            app_environment_snapshot,
            agents_device_snapshot,
            agents_register_folder_scope,
            agents_open_citation,
            agents_prepare_document,
            agents_prepare_scoped_document,
            #[cfg(desktop)]
            agents_device_identity_load,
            #[cfg(desktop)]
            agents_device_identity_store,
            claude_status,
            claude_send_message,
            claude_drain_events,
            claude_abort,
            check_system,
            probe_paths,
            misty_template_status,
            build_misty_template,
            install_misty_template,
            restart_misty_app,
            ensure_local_access_token,
            fetch_misty_releases,
            save_authenticated_user,
            save_verified_license,
            sign_out_misty,
            launch_misty,
            restart_misty,
            stop_misty,
            #[cfg(desktop)]
            scan_local_plugins,
            #[cfg(desktop)]
            install_plugin_bundle,
            #[cfg(desktop)]
            set_plugin_enabled,
            #[cfg(desktop)]
            uninstall_plugin,
            get_misty_process_status,
            open_external_url,
            storage_snapshot,
            clipboard_snapshot,
            clipboard_set_local,
            clipboard_publish_shared,
            clipboard_publish_image_bytes,
            clipboard_apply_shared,
            clipboard_shared_image_bytes,
            clipboard_native_file_refs,
            clipboard_write_file_bytes,
            clipboard_write_file_refs,
            notes_store_asset,
            devices_snapshot,
            explorer_list_directory,
            #[cfg(target_os = "android")]
            android_grant_local_folder,
            #[cfg(target_os = "android")]
            android_all_files_access_status,
            #[cfg(target_os = "android")]
            android_open_all_files_access_settings,
            explorer_directory_size_snapshot,
            explorer_calculate_directory_sizes,
            explorer_create_item,
            explorer_rename_item,
            explorer_delete_items,
            explorer_paste_items,
            explorer_prepare_open_item,
            explorer_prepare_drag_items,
            explorer_cancel_drag_preparation,
            explorer_preview_item,
            explorer_save_preview_item,
            explorer_generate_image_thumbnail,
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
            smart_library_snapshot,
            smart_library_scan,
            smart_library_import_files,
            smart_library_preflight_import,
            smart_library_prepare_previews,
            smart_library_apply_results,
            smart_library_set_server_folder_id,
            smart_library_search,
            smart_library_resolve_assets,
            smart_library_assets_page,
            smart_library_delete,
            #[cfg(desktop)]
            media_search_scan_movies,
            #[cfg(desktop)]
            media_search_snapshot,
            #[cfg(desktop)]
            media_search_prepare_chunk,
            #[cfg(desktop)]
            media_search_complete,
            #[cfg(desktop)]
            media_search_approve_assets,
            #[cfg(desktop)]
            media_search_acknowledge_removed_assets,
            #[cfg(desktop)]
            media_search_record_chunk,
            #[cfg(desktop)]
            media_search_set_asset_state,
            #[cfg(desktop)]
            media_search_reset_device_index,
            #[cfg(desktop)]
            media_search_complete_legacy_adoption,
            #[cfg(desktop)]
            media_search_resolve_assets,
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
            #[cfg(desktop)]
            plugin_commands_snapshot,
            #[cfg(desktop)]
            plugin_command_run,
            #[cfg(desktop)]
            plugin_panel_render,
            extension_command_run,
            #[cfg(desktop)]
            plugin_diagnostics_snapshot,
            providers_snapshot,
            providers_refresh,
            providers_import_cloud_connection,
            providers_select_remote,
            providers_save_remote,
            providers_test_remote,
            providers_config_paths,
            providers_configure_remote,
            providers_verify_start,
            providers_job_status,
            providers_job_cancel,
            providers_verify_result,
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
            operation_queue_retry_transfer,
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
            telemetry::telemetry_set_error_reporting_enabled,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Misty Tauri app")
        .run(|_app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                telemetry::shutdown();
            }
        });
}
