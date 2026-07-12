// Several platform-gated and migration paths are intentionally compiled but
// not active in every desktop build. Keep those paths available to the mobile
// and upgrade targets without treating their absence from this target as lint
// failures.
#![allow(dead_code, unused_imports, unused_variables)]

#[cfg(not(target_os = "macos"))]
use crate::app::commands::agents_prepare_document;
mod app;
mod domain;
mod error;
mod infra;
mod platform;
mod shell_plugins;
mod telemetry;
#[cfg(all(desktop, debug_assertions))]
mod development_profile;

#[cfg(desktop)]
use app::commands::{
    agents_device_identity_load, agents_device_identity_store,
    media_search_acknowledge_removed_assets, media_search_approve_assets, media_search_complete,
    media_search_complete_legacy_adoption, media_search_prepare_chunk, media_search_record_chunk,
    media_search_reset_device_index, media_search_resolve_assets, media_search_scan_movies,
    media_search_set_asset_state, media_search_snapshot,
};
use app::commands::{
    agents_device_snapshot, agents_open_citation,
    agents_prepare_scoped_document, agents_register_folder_scope, app_configure_server,
    app_environment_snapshot, app_snapshot, archive_create, archive_extract, archive_list,
    claude_abort, claude_drain_events, claude_send_message, claude_status, clipboard_apply_shared,
    clipboard_native_file_refs, clipboard_publish_image_bytes, clipboard_publish_shared,
    clipboard_set_local, clipboard_shared_image_bytes, clipboard_snapshot,
    clipboard_write_file_bytes, clipboard_write_file_refs, coding_ai_clear_api_key,
    coding_ai_read_api_key, coding_ai_write_api_key, compare_apply_text_merge, compare_files,
    compare_folders, devices_snapshot, devices_unmount, duplicates_cancel,
    duplicates_hash_remote_candidates, duplicates_scan, explorer_calculate_directory_sizes,
    explorer_cancel_drag_preparation, explorer_create_item, explorer_delete_items,
    explorer_directory_size_snapshot, explorer_generate_image_thumbnail,
    explorer_library_record_last_opened, explorer_library_record_recent, explorer_library_set_tags,
    explorer_library_snapshot, explorer_list_directory, explorer_open_association,
    explorer_open_path, explorer_open_with, explorer_paste_items, explorer_path_exists,
    explorer_path_is_directory, explorer_prepare_drag_items, explorer_prepare_open_item,
    explorer_preview_item, explorer_queue_create_item, explorer_queue_delete_items,
    explorer_queue_paste_blob, explorer_queue_paste_items, explorer_queue_paste_text,
    explorer_queue_rename_item, explorer_queue_rename_items, explorer_rename_item,
    explorer_save_preview_item, explorer_set_open_association,
    file_metadata_snapshot, file_sync_apply, file_sync_compare, file_sync_pair_remove,
    file_sync_pair_save, file_sync_pairs_snapshot, file_tools_checksum, file_tools_chmod,
    file_tools_create_symlink, file_tools_read_symlink, file_tools_set_readonly, mail_cache_read,
    mail_cache_remove, mail_cache_write, mobile_cache_purge_account, mobile_cache_read,
    mobile_cache_remove, mobile_cache_write, navigation_names_snapshot, navigation_names_update,
    notes_store_asset, open_terminal_at_path, operation_queue_cancel, operation_queue_cancel_batch,
    operation_queue_clear_terminal, operation_queue_pause, operation_queue_pause_all,
    operation_queue_pause_batch, operation_queue_redo, operation_queue_resolve_conflict,
    operation_queue_resume, operation_queue_resume_all, operation_queue_resume_batch,
    operation_queue_retry, operation_queue_retry_transfer, operation_queue_set_bandwidth_limit,
    operation_queue_set_transfer_profile, operation_queue_snapshot, operation_queue_undo,

    providers_backend_actions, providers_config_paths, providers_config_security,
    providers_configure_remote, providers_disconnect_remote, providers_harden_config,
    providers_import_cloud_connection, providers_job_cancel, providers_job_status,
    providers_refresh, providers_repair_config_security, providers_run_backend_action,
    providers_save_remote, providers_select_remote, providers_snapshot, providers_test_remote,
    providers_verify_result, providers_verify_start, saved_searches_delete, saved_searches_save,
    saved_searches_snapshot, search_cancel_scan, search_get_status, search_init, search_query,
    search_start_scan,
    settings_apply_launch_on_login, settings_launch_on_login_snapshot,
    settings_open_with_associations, settings_remove_open_with_association, settings_save,
    settings_snapshot, smart_library_apply_results, smart_library_assets_page,
    smart_library_delete, smart_library_import_files, smart_library_preflight_import,
    smart_library_prepare_previews, smart_library_resolve_assets, smart_library_scan,
    smart_library_search, smart_library_set_server_folder_id, smart_library_snapshot,
    storage_snapshot, transfers_delete_all, transfers_delete_selected, transfers_snapshot,
    workspaces_save, workspaces_snapshot,
};
#[cfg(target_os = "android")]
use app::commands::{
    android_all_files_access_status, android_grant_local_folder,
    android_open_all_files_access_settings,
};
#[cfg(any(desktop, target_os = "ios"))]
use app::commands::{
    connected_devices_connect, connected_devices_initialize, connected_devices_list_directory,
    connected_devices_media_url, connected_devices_open_workspace_route,
    connected_devices_prepare_clipboard_files, connected_devices_read_file,
    connected_devices_roots, connected_devices_snapshot, connected_devices_subscribe_directory,
};
use app::runtime::MistyRuntime;
use app::shortcut_commands::{
    shortcuts_reassign, shortcuts_reset, shortcuts_snapshot, shortcuts_update,
};
#[cfg(any(desktop, target_os = "ios"))]
use infra::browser::{
    browser_agent_execute, browser_agent_grant_register, browser_agent_grant_revoke,
    browser_webview_back, browser_webview_capture_region, browser_webview_close,
    browser_webview_create, browser_webview_forward, browser_webview_hide,
    browser_webview_navigate, browser_webview_reconcile, browser_webview_reload,
    browser_webview_set_bounds, browser_webview_set_theme, browser_webview_set_zoom,
    browser_webview_show, browser_webviews_hide_all, browser_webviews_park_all,
    browser_webview_set_pane_dim, browser_webviews_set_companion, browser_webviews_set_overlay_active,
    browser_webviews_set_pointer_tracking, browser_webviews_set_status_bubble, BrowserSessionState,
};
use infra::browser_search_suggest::browser_search_suggest;
#[cfg(desktop)]
use infra::browser_history::{
    browser_history_clear, browser_history_delete, browser_history_query, browser_history_record,
    browser_history_forget, browser_history_set_title, browser_history_suggest,
};
#[cfg(desktop)]
use infra::browser_library::{
    browser_download_cancel, browser_download_open, browser_download_reveal,
    browser_downloads_list, browser_downloads_progress, browser_downloads_remove,
};
#[cfg(desktop)]
use infra::browser::{
    browser_clear_website_data, browser_set_download_directory, browser_set_download_prompt, browser_webview_set_muted, browser_webview_developer_tools, browser_webview_find, browser_webview_print,
    browser_webview_save_page, browser_webview_stop,
};
#[cfg(desktop)]
use infra::browser_agent_control::{
    browser_agent_execute_bounded, browser_agent_execution_cancel, browser_agent_execution_renew,
    BrowserExecutionState,
};
#[cfg(desktop)]
use infra::browser_shortcuts::browser_shortcuts_update;
#[cfg(all(desktop, not(target_os = "macos")))]
use infra::code_lsp::{code_lsp_send, code_lsp_start, code_lsp_stop};
use infra::misty::{
    check_system, ensure_local_access_token, fetch_misty_releases,
    get_misty_process_status, launch_misty,
    open_external_url, probe_paths,
    restart_misty, save_authenticated_user, save_verified_license,
    sign_out_misty, stop_misty,
};
use infra::misty_template::{
    build_misty_template, install_misty_template, misty_template_status, restart_misty_app,
};
#[cfg(desktop)]
use infra::ssh_terminal::{
    terminal_ssh_environments, terminal_ssh_preflight, terminal_ssh_trust_host,
};
#[cfg(target_os = "macos")]
use platform::mini_app::permissions::mini_app_duplicate_file_grant;
#[cfg(target_os = "macos")]
use platform::mini_app::permissions::peer::{space_peer_local_identity,space_peer_start,space_peer_snapshot,space_peer_set_peers,space_peer_stop,space_peer_connect,space_peer_request,space_peer_read,space_peer_prepare};
#[cfg(target_os = "macos")]
use infra::terminal_service::{
    terminal_service_call, terminal_service_close, terminal_service_create, terminal_service_request,
};
#[cfg(desktop)]
use infra::terminal::{
    terminal_create, terminal_interrupt, terminal_kill, terminal_resize, terminal_write,
};
#[cfg(desktop)]
use infra::tray;
use platform::plugins::mac_rounded_corners;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use telemetry::TelemetryReporter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    #[cfg(all(desktop, debug_assertions))]
    development_profile::configure(&mut context).expect("invalid development profile");
    // Use one TLS provider for backend calls, updates and the peer transport.
    let _ = rustls::crypto::ring::default_provider().install_default();
    telemetry::initialize();
    let builder = tauri::Builder::default();

    // Register this first so duplicate launches are rejected before any other
    // plugin or application service can initialize a second Misty runtime.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if !mac_rounded_corners::main_window_ready() {
            return;
        }
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
        .plugin(shell_plugins::ShellScriptPlugin(tauri_plugin_notification::init()))
        .plugin(shell_plugins::ShellScriptPlugin(tauri_plugin_opener::init()))
        .plugin(tauri_plugin_os::init())
        .setup(move |app| {
            #[cfg(all(desktop, debug_assertions))]
            if let Ok(profile) = std::env::var("MISTY_DESKTOP_PROFILE")
                .or_else(|_| std::env::var("MISTY_PROFILE"))
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_title(&profile)?;
                }
            }
            #[cfg(target_os = "macos")]
            misty_browser_sync::secure_store::configure_device_store(
                app.path().local_data_dir()?.join("com.misty.desktop/device-keys"),
            )?;
            #[cfg(any(target_os = "ios", target_os = "android"))]
            let runtime = {
                let data_root = app
                    .path()
                    .app_data_dir()
                    .ok()
                    .map(|path| path.join("Misty"));
                if let Some(root) = &data_root {
                    infra::paths::set_mobile_data_root(root.clone());
                }
                MistyRuntime::new_with_data_root(data_root)
            };
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            let runtime = MistyRuntime::new();
            #[cfg(desktop)]
            {
                let route_app = app.handle().clone();
                let _ = runtime
                    .connected_devices
                    .set_workspace_route_handler(Arc::new(move |request| {
                        route_app
                            .emit("misty://open-workspace-route", request)
                            .is_ok()
                    }));
            }
            app.manage(runtime);
            #[cfg(any(desktop, target_os = "ios"))]
            app.manage(BrowserSessionState::default());
            app.manage(infra::agent_workspace::AgentWorkspaceState::default());
            #[cfg(any(target_os = "macos", windows))]
            app.manage(std::sync::Arc::new(infra::cursor_companion::CursorCompanionState::default()));
            #[cfg(desktop)]
            app.manage(BrowserExecutionState::default());
            // The floating Misty window is intentionally not created during
            // the first public beta. The in-app Misty panel remains available.
            #[cfg(desktop)]
            if let Err(error) = tray::setup(app) {
                let error = std::io::Error::other(error);
                telemetry::PostHogTelemetryReporter
                    .capture_error(&error, telemetry::SafeOperation::ApplicationStartup);
                return Err(error.into());
            }
            #[cfg(target_os = "macos")]
            infra::app_menu::setup(app)?;
            #[cfg(target_os = "macos")]
            infra::devices::start_device_change_listener(app.handle().clone());
            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder
        .manage(platform::mini_app::MiniAppState::default());

    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        #[cfg(target_os = "macos")]
        if infra::app_menu::handle_menu_event(app, id) {
            return;
        }
        tray::handle_menu_event(app, id);
    });

    builder
        .on_window_event(|_window, _event| {
            #[cfg(all(desktop, not(target_os = "macos")))]
            {
                let (window, event) = (_window, _event);
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
            // macOS owns live window layout. Traffic lights are positioned
            // during window setup; rewriting their frames on every resize
            // competes with AppKit and makes the titlebar controls jitter.
        })
        .invoke_handler({
            let dispatch: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
                Box::new(tauri::generate_handler![
                    crate::infra::browser_sync::browser_sync_availability,
                    crate::infra::browser_sync::handoff::browser_sync_restore_credentials,
                    crate::infra::browser_sync::handoff::browser_sync_capture_credentials,
                    crate::infra::workspace_recovery::browser_recovery_open,
                    crate::infra::workspace_recovery::browser_recovery_read,
                    crate::infra::workspace_recovery::browser_recovery_write,
                    crate::infra::workspace_recovery::browser_recovery_forget,
                    crate::infra::browser_sync::browser_sync_generate_secret,
                    crate::infra::browser_sync::browser_sync_setup,
                    crate::infra::browser_sync::browser_sync_connect,
                    crate::infra::browser_sync::browser_sync_state,
                    crate::infra::browser_sync::browser_sync_edit,
                    crate::infra::browser_sync::browser_sync_resume,
                    crate::infra::browser_sync::browser_sync_activate,
                    crate::infra::browser_sync::browser_sync_claim,
                    crate::infra::browser_sync::browser_sync_rename_device,
                    crate::infra::page_state::browser_page_state_capture,
                    crate::infra::page_state::browser_page_state_restore,
                    crate::infra::page_state::browser_page_state_controls,
                    crate::infra::page_state::browser_page_state_act,
                    crate::infra::page_state::browser_page_state_guard,
                    crate::infra::page_state::history::browser_tab_history_save,
                    crate::infra::page_state::history::browser_tab_history_load,
                    crate::infra::browser_sync::browser_sync_control_device,
                    crate::infra::browser_sync::browser_sync_lock,
                    crate::infra::browser_sync::browser_sync_forget_key,
                    crate::infra::auth_cookies::auth_cookie_capture,
                    crate::infra::auth_cookies::auth_cookie_restore,
                    crate::infra::auth_cookies::auth_cookie_forget,
                    crate::infra::auth_http::auth_http_start,
                    crate::infra::auth_http::auth_http_read,
                    crate::infra::auth_http::auth_http_cancel,
                    crate::infra::misty_context::misty_workspace_focused,
                    crate::infra::misty_context::misty_screen_status,
                    crate::infra::misty_context::misty_screen_capture,
                    crate::infra::workspace_autopilot::agent_workspace_context,
                    #[cfg(desktop)]
                    platform::mini_app::builtin_service_open,
                    #[cfg(desktop)]
                    platform::mini_app::mini_app_close,
                    #[cfg(desktop)]
                    platform::mini_app::permissions::mini_app_permission_status,
                    #[cfg(desktop)]
                    platform::mini_app::permissions::mini_app_permission_decide,
                    #[cfg(desktop)]
                    platform::mini_app::permissions::mini_app_permission_list,
                    #[cfg(desktop)]
                    platform::mini_app::permissions::mini_app_context,
                    #[cfg(desktop)]
                    platform::mini_app::permissions::mini_app_device_call,
                    platform::mini_app::permissions::host_files::mini_app_host_file,
                    mac_rounded_corners::reveal_main_window,
                    mac_rounded_corners::enable_rounded_corners,
                    mac_rounded_corners::enable_modern_window_style,
                    mac_rounded_corners::enable_custom_titlebar_window_style,
                    mac_rounded_corners::reposition_traffic_lights,
                    mac_rounded_corners::set_native_wallpaper_video,
                    app_snapshot,
                    app_environment_snapshot,
                    app_configure_server,
                    mail_cache_read,
                    mail_cache_write,
                    mail_cache_remove,
                    mobile_cache_read,
                    mobile_cache_write,
                    mobile_cache_remove,
                    mobile_cache_purge_account,
                    agents_device_snapshot,
                    agents_register_folder_scope,
                    agents_open_citation,
                    #[cfg(not(target_os = "macos"))]
                    agents_prepare_document,
                    agents_prepare_scoped_document,
                    #[cfg(desktop)]
                    agents_device_identity_load,
                    #[cfg(desktop)]
                    agents_device_identity_store,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_initialize,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_snapshot,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_subscribe_directory,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_connect,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_open_workspace_route,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_roots,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_list_directory,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_read_file,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_media_url,
                    #[cfg(any(desktop, target_os = "ios"))]
                    connected_devices_prepare_clipboard_files,
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
                    get_misty_process_status,
                    open_external_url,
                    #[cfg(desktop)]
                    terminal_create,
                    #[cfg(target_os = "macos")]
                    terminal_service_create,
                    #[cfg(target_os = "macos")]
                    mini_app_duplicate_file_grant,
                    #[cfg(target_os = "macos")]
                    space_peer_start,
                    #[cfg(target_os = "macos")]
                    space_peer_local_identity,
                    #[cfg(target_os = "macos")]
                    space_peer_snapshot,
                    #[cfg(target_os = "macos")]
                    space_peer_set_peers,
                    #[cfg(target_os = "macos")]
                    space_peer_stop,
                    #[cfg(target_os = "macos")]
                    space_peer_connect,
                    #[cfg(target_os = "macos")]
                    space_peer_request,
                    #[cfg(target_os = "macos")]
                    space_peer_read,
                    #[cfg(target_os = "macos")]
                    space_peer_prepare,
                    #[cfg(target_os = "macos")]
                    terminal_service_call,
                    #[cfg(target_os = "macos")]
                    terminal_service_close,
                    #[cfg(target_os = "macos")]
                    terminal_service_request,
                    #[cfg(desktop)]
                    terminal_write,
                    #[cfg(desktop)]
                    terminal_resize,
                    #[cfg(desktop)]
                    terminal_interrupt,
                    #[cfg(desktop)]
                    terminal_kill,
                    #[cfg(desktop)]
                    terminal_ssh_environments,
                    #[cfg(desktop)]
                    terminal_ssh_preflight,
                    #[cfg(desktop)]
                    terminal_ssh_trust_host,
                    #[cfg(all(desktop, not(target_os = "macos")))]
                    code_lsp_start,
                    #[cfg(all(desktop, not(target_os = "macos")))]
                    code_lsp_send,
                    #[cfg(all(desktop, not(target_os = "macos")))]
                    code_lsp_stop,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_create,
                    infra::agent_workspace::agent_window_open,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_configure,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_interrupt,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_present,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_capture,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_bind_task,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_snapshot,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::agent_workspace::agent_window_take_task,
                    infra::agent_workspace::agent_window_ack_task,
                    infra::agent_workspace::agent_foreground_queue,
                    infra::agent_workspace::agent_workspace_acquire,
                    infra::agent_workspace::agent_workspace_release,
                    infra::agent_workspace::agent_workspace_bind_scope,
                    #[cfg(desktop)]
                    infra::browser::browser_runtime_for_scope,
                    #[cfg(desktop)]
                    infra::browser::browser_agent_set_locked,
                    infra::agent_workspace::agent_browser_session_id,
                    #[cfg(target_os = "macos")]
                    crate::infra::browser::browser_context_menu_availability,
                    #[cfg(target_os = "macos")]
                    crate::infra::browser::browser_context_menu_select,
                    #[cfg(desktop)]
                    crate::infra::browser::browser_profile_persistence,
                    crate::infra::browser::browser_profile_remove,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_shortcuts_update,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_set_bounds,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_capture_region,
                    #[cfg(target_os = "macos")]
                    infra::browser_macos::host_webview_capture_region,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_reconcile,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_set_theme,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_navigate,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_back,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_forward,
                    #[cfg(any(desktop, target_os = "ios"))]
                    browser_webview_reload,
                    #[cfg(target_os = "macos")]
                    infra::browser_site_permissions::browser_site_info,
                    #[cfg(target_os = "macos")]
                    infra::browser_site_permissions::browser_site_permissions_set,
                    #[cfg(target_os = "macos")]
                    infra::browser_site_permissions::browser_site_permissions_list,
                    #[cfg(target_os = "macos")]
                    infra::browser_site_permissions::browser_site_permissions_reset,
                    browser_webview_set_zoom,
                    #[cfg(desktop)]
                    browser_webview_show,
                    #[cfg(desktop)]
                    browser_webviews_set_overlay_active,
                    #[cfg(desktop)]
                    browser_webviews_set_pointer_tracking,
                    #[cfg(desktop)]
                    browser_webviews_set_status_bubble,
                    #[cfg(desktop)]
                    browser_webview_stop,
                    #[cfg(desktop)]
                    browser_webview_find,
                    #[cfg(desktop)]
                    browser_webview_print,
                    #[cfg(desktop)]
                    browser_webview_save_page,
                    #[cfg(desktop)]
                    browser_webview_developer_tools,
                    #[cfg(desktop)]
                    browser_clear_website_data,
                    #[cfg(desktop)]
                    browser_set_download_directory,
                    #[cfg(desktop)]
                    browser_set_download_prompt,
                    #[cfg(desktop)]
                    browser_webview_set_muted,
                    #[cfg(desktop)]
                    browser_history_clear,
                    #[cfg(desktop)]
                    browser_history_delete,
                    #[cfg(desktop)]
                    browser_history_query,
                    #[cfg(desktop)]
                    browser_history_record,
                    #[cfg(desktop)]
                    browser_history_set_title,
                    #[cfg(desktop)]
                    browser_history_suggest,
                    #[cfg(desktop)]
                    browser_history_forget,
                    browser_search_suggest,
                    #[cfg(desktop)]
                    browser_download_cancel,
                    #[cfg(desktop)]
                    browser_download_open,
                    #[cfg(desktop)]
                    browser_download_reveal,
                    #[cfg(desktop)]
                    browser_downloads_list,
                    #[cfg(desktop)]
                    browser_downloads_progress,
                    #[cfg(desktop)]
                    browser_downloads_remove,
                    #[cfg(desktop)]
                    browser_webview_set_pane_dim,
                    browser_webviews_set_companion,
                    #[cfg(desktop)]
                    browser_webview_hide,
                    #[cfg(desktop)]
                    browser_webviews_hide_all,
                    #[cfg(desktop)]
                    browser_webviews_park_all,
                    #[cfg(desktop)]
                    browser_webview_close,
                    #[cfg(desktop)]
                    browser_agent_grant_register,
                    #[cfg(desktop)]
                    browser_agent_grant_revoke,
                    #[cfg(desktop)]
                    browser_agent_execute,
                    #[cfg(desktop)]
                    browser_agent_execute_bounded,
                    #[cfg(desktop)]
                    browser_agent_execution_cancel,
                    #[cfg(desktop)]
                    browser_agent_execution_renew,
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
                    devices_unmount,
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
                    navigation_names_snapshot,
                    navigation_names_update,
                    workspaces_snapshot,
                    workspaces_save,
                    settings_snapshot,
                    settings_save,
                    settings_launch_on_login_snapshot,
                    settings_apply_launch_on_login,
                    settings_open_with_associations,
                    settings_remove_open_with_association,
                    coding_ai_read_api_key,
                    coding_ai_write_api_key,
                    coding_ai_clear_api_key,
                    shortcuts_snapshot,
                    shortcuts_update,
                    shortcuts_reassign,
                    shortcuts_reset,
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
                ]);
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                if !platform::app_command_policy::allows(
                    invoke.message.webview_ref().label(),
                    invoke.message.command(),
                ) {
                    invoke
                        .resolver
                        .reject("This view cannot invoke Host commands.");
                    return true;
                }
                dispatch(invoke)
            }
        })
        .build(context)
        .expect("failed to build Misty Tauri app")
        .run(|_app, event| {
            // Dock activation must work even if the frontend is still loading
            // or failed before it could report readiness.
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                if let Err(error) = tray::show_main_window(_app) {
                    eprintln!("Could not reopen Misty: {error}");
                }
            }
            if matches!(event, tauri::RunEvent::Exit) {
                #[cfg(desktop)]
                platform::mini_app::shutdown(_app);
                telemetry::shutdown();
            }
        });
}
