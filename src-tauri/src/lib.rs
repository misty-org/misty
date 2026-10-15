// Several platform-gated and migration paths are intentionally compiled but
// not active in every desktop build. Keep those paths available to the native
// and upgrade targets without treating their absence from this target as lint
// failures.
#![allow(dead_code, unused_imports, unused_variables)]

mod agents;
mod app;
#[cfg(all(desktop, debug_assertions))]
mod development_profile;
mod domain;
mod error;
mod infra;
mod platform;
mod shell_plugins;
mod telemetry;
mod voice;

#[cfg(desktop)]
use app::commands::{};
use app::commands::{
    agents_choose_folder_scope, agents_device_snapshot, agents_list_scoped_files,
    agents_prepare_scoped_document, agents_revoke_folder_scope, app_snapshot,
    clipboard_apply_shared, clipboard_native_file_refs, clipboard_publish_image_bytes,
    clipboard_publish_shared, clipboard_set_local, clipboard_shared_image_bytes,
    clipboard_snapshot, clipboard_write_file_bytes, clipboard_write_file_refs, devices_snapshot,
    explorer_list_directory, explorer_prepare_open_item, navigation_names_snapshot,
    navigation_names_update, settings_apply_launch_on_login, settings_default_browser_snapshot,
    settings_launch_on_login_snapshot, settings_profile_commit, settings_profile_state,
    settings_request_default_browser, settings_save, settings_snapshot,
};

#[cfg(desktop)]
use app::device_admission_commands::{
    devices_admit_self, devices_approval_status, devices_approve_confirm, devices_approve_start,
    devices_approve_status, devices_deny, devices_pending_requests, devices_publish_folders,
    devices_remove, devices_rename, devices_request_approval, devices_set_policy,
};
#[cfg(desktop)]
use app::device_commands::{devices_refresh, devices_start, devices_stop, devices_view};
#[cfg(desktop)]
use app::device_job_commands::{
    device_read_shared_file, device_sign_request, device_sign_run_grants, device_verify_job,
};
#[cfg(desktop)]
use app::runner_commands::{
    coding_engines_detect, coding_project_remote, coding_route, coding_run_turn, coding_runner_answer,
    coding_runner_stop,
};
use app::runtime::MistyRuntime;
use app::shortcut_commands::{shortcuts_replace, shortcuts_snapshot};
#[cfg(desktop)]
use infra::browser::action_confirm::agent_action_confirm;
#[cfg(desktop)]
use infra::browser::host_messages::passwords::{
    browser_password_offer_respond, browser_passwords_delete, browser_passwords_list,
    browser_passwords_reveal, browser_passwords_save,
};
#[cfg(desktop)]
use infra::browser::page_tools::media_tools::session::{
    browser_webview_media_action, browser_webview_media_info,
};
#[cfg(desktop)]
use infra::browser::page_tools::media_tools::{
    browser_webview_media_playback, browser_webview_picture_in_picture,
    browser_webview_reader_article,
};
use infra::browser::pane_dim::browser_webview_set_pane_dim;
#[cfg(desktop)]
use infra::browser::profile_cleanup::browser_device_profile_delete;
#[cfg(desktop)]
use infra::browser::{
    browser_agent_execute, browser_agent_grant_register, browser_agent_grant_revoke,
    browser_webview_back, browser_webview_capture_region, browser_webview_close,
    browser_webview_create, browser_webview_forward, browser_webview_held, browser_webview_hide,
    browser_webview_navigate, browser_webview_preview_document, browser_webview_reconcile,
    browser_webview_reload, browser_webview_set_bounds, browser_webview_set_theme,
    browser_webview_set_zoom, browser_webview_show, browser_webviews_hide_all,
    browser_webviews_hide_except,
    browser_webviews_park_all, browser_webviews_set_overlay_active,
    browser_webviews_set_pointer_tracking, browser_webviews_set_status_bubble, BrowserSessionState,
};
#[cfg(desktop)]
use infra::browser::{
    browser_clear_website_data, browser_set_download_directory, browser_set_download_prompt,
    browser_webview_developer_tools, browser_webview_find, browser_webview_print,
    browser_webview_save_page, browser_webview_set_muted, browser_webview_stop,
};
#[cfg(desktop)]
use infra::browser_agent_control::{
    browser_agent_execute_bounded, browser_agent_execution_cancel, browser_agent_execution_renew,
    BrowserExecutionState,
};
#[cfg(desktop)]
use infra::browser_history::{
    browser_history_clear, browser_history_delete, browser_history_forget, browser_history_query,
    browser_history_record, browser_history_set_title, browser_history_suggest,
};
#[cfg(desktop)]
use infra::browser_import::{
    browser_import_bookmarks, browser_import_bookmarks_file, browser_import_discover,
    browser_import_history, browser_import_preview, browser_import_save_bookmarks,
    browser_import_settings, browser_import_signins,
};
#[cfg(desktop)]
use infra::browser_library::{
    browser_download_cancel, browser_download_open, browser_download_reveal,
    browser_downloads_list, browser_downloads_progress, browser_downloads_remove,
};
use infra::browser_search_suggest::browser_search_suggest;
#[cfg(desktop)]
use infra::browser_shortcuts::browser_shortcuts_update;
#[cfg(desktop)]
use infra::browser_site_style::browser_set_mouse_gestures;
use infra::misty::{check_system, save_authenticated_user, save_verified_license, sign_out_misty};
#[cfg(desktop)]
use infra::tray;
use platform::plugins::mac_rounded_corners;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use telemetry::TelemetryReporter;

pub fn run() {
    // Only development builds adjust the context.
    #[cfg_attr(not(all(desktop, debug_assertions)), allow(unused_mut))]
    let mut context = tauri::generate_context!();
    #[cfg(all(desktop, debug_assertions))]
    development_profile::configure(&mut context).expect("invalid development profile");
    // The credential store lives in the same database as every other store, so both must
    // resolve the same data root (tests and development profiles can move it).
    if let Some(home) = infra::paths::misty_home_dir() {
        let _ = misty_credential_store::configure_root(home.join(".local").join("data"));
    }
    // Use one TLS provider for backend calls and updates.
    let _ = rustls::crypto::ring::default_provider().install_default();
    telemetry::initialize();
    let builder = tauri::Builder::default();

    // Register this first so duplicate launches are rejected before any other
    // plugin or application service can initialize a second Misty runtime.
    infra::default_browser::remember_launch(std::env::args().skip(1));
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
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
        // Links opened while Misty runs, as the default browser.
        let urls = infra::default_browser::web_urls(args.iter().skip(1));
        if !urls.is_empty() {
            let _ = app.emit("deep-link://new-url", urls);
        }
    }));

    // Web APIs that website tabs reach natively; see kiri/README.md.
    #[cfg(desktop)]
    let builder = builder.plugin(infra::browser_kiri::plugin());

    // WebKit can end a page's process while Misty is in the background; reload
    // it as Tauri would, and log which page it was.
    #[cfg(target_os = "macos")]
    let builder =
        builder.on_web_content_process_terminate(infra::browser_process_ended::page_process_ended);

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder
        // Keeps privileged windows on the bundled app; see navigation_guard.rs.
        .plugin(platform::navigation_guard::init())
        // Replaces Tauri's asset handler so website views cannot read local files.
        .register_asynchronous_uri_scheme_protocol("asset", |context, request, responder| {
            platform::asset_protocol::handle(context, request, responder)
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keystore::init())
        .plugin(shell_plugins::ShellScriptPlugin(
            tauri_plugin_notification::init(),
        ))
        .plugin(shell_plugins::ShellScriptPlugin(tauri_plugin_opener::init()))
        .plugin(tauri_plugin_os::init())
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            platform::plugins::mac_pip_observer::install(app.handle());
            // Debug-only: the browser benchmark runs its tasks in Misty's own
            // tabs when asked to; see browser_eval_bridge.rs.
            #[cfg(all(desktop, debug_assertions))]
            infra::browser::eval_bridge::start_if_requested(app.handle());
            // Debug-only end-to-end check of Kiri; see browser_kiri_probe.rs.
            #[cfg(all(debug_assertions, target_os = "macos"))]
            if std::env::var_os("MISTY_KIRI_PROBE").is_some() {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let passed = infra::browser::kiri_probe::run(handle.clone()).await;
                    println!(
                        "KIRI PROBE DONE: {}",
                        if passed { "all passed" } else { "failures" }
                    );
                    handle.exit(if passed { 0 } else { 1 });
                });
            }
            #[cfg(all(desktop, debug_assertions))]
            if let Ok(profile) =
                std::env::var("MISTY_DESKTOP_PROFILE").or_else(|_| std::env::var("MISTY_PROFILE"))
            {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_title(&profile)?;
                }
            }

            // Runs only in the primary instance, before any service opens a
            // file under ~/.misty. Services still create what they need, so a
            // failure here is reported rather than blocking launch.
            if let Err(error) = infra::misty_home::ensure_misty_home() {
                telemetry::PostHogTelemetryReporter
                    .capture_error(&error, telemetry::SafeOperation::ApplicationStartup);
            }
            let runtime = MistyRuntime::new();
            // What this device trusts (vault root pin, device list, its own
            // policy) lives beside its other app data.
            #[cfg(desktop)]
            infra::device_trust::set_storage_root(
                runtime
                    .environment
                    .store()
                    .path()
                    .parent()
                    .map(std::path::Path::to_path_buf)
                    .unwrap_or_default(),
            );
            app.manage(infra::agent_files::AgentFilesState::default());
            #[cfg(all(desktop, any(unix, windows)))]
            infra::clipboard_bridge::start(
                app.handle().clone(),
                runtime.environment.store(),
                runtime.environment.config_dir(),
            );
            app.manage(runtime);
            #[cfg(desktop)]
            app.manage(BrowserSessionState::default());
            app.manage(infra::agent_workspace::AgentWorkspaceState::default());
            #[cfg(any(target_os = "macos", windows))]
            app.manage(std::sync::Arc::new(
                infra::cursor_companion::CursorCompanionState::default(),
            ));
            #[cfg(any(target_os = "macos", windows))]
            app.manage(voice::DictationState::default());
            #[cfg(any(target_os = "macos", windows))]
            app.manage(voice::CaptureState::default());
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
            #[cfg(any(target_os = "macos", windows))]
            infra::devices::start_device_change_listener(app.handle().clone());
            #[cfg(windows)]
            infra::misty_context_windows::start_foreground_watch();
            #[cfg(windows)]
            if let Some(main) = app.get_webview("main") {
                infra::browser_process_ended::watch_page_process(&main);
            }
            Ok(())
        });

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
            platform::app_lifecycle::window_event(_window, _event);
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
                    crate::infra::extensions::install::extensions_prepare,
                    crate::infra::extensions::install::extensions_commit,
                    crate::infra::extensions::runtime::extensions_reconcile,
                    crate::infra::extensions::runtime::extensions_action,
                    crate::infra::extensions::runtime::extensions_respond,
                    crate::infra::extensions::runtime::extensions_tab_created,
                    crate::infra::extensions::extensions_layout,
                    crate::infra::extensions::extensions_compat,
                    crate::infra::extensions::runtime::extensions_check_updates,
                    crate::infra::browser_sync::browser_sync_availability,
                    crate::infra::workspace_recovery::browser_recovery_open,
                    crate::infra::workspace_recovery::browser_recovery_read,
                    crate::infra::workspace_recovery::browser_recovery_write,
                    crate::infra::workspace_recovery::browser_recovery_forget,
                    crate::platform::app_lifecycle::app_quit_confirmed,
                    crate::infra::browser_sync::browser_sync_generate_secret,
                    crate::infra::browser_sync::browser_sync_setup,
                    crate::infra::browser_sync::browser_sync_connect,
                    crate::infra::browser_sync::browser_sync_state,
                    crate::infra::browser_sync::browser_sync_account_feed,
                    crate::infra::browser_sync::browser_sync_edit,
                    crate::infra::browser_sync::browser_sync_activate,
                    crate::infra::browser_sync::browser_sync_claim,
                    crate::infra::browser_sync::browser_sync_flush,
                    crate::infra::browser_sync::browser_sync_rename_device,
                    crate::infra::page_state::browser_page_state_capture,
                    crate::infra::page_state::browser_page_state_restore,
                    crate::infra::page_state::browser_page_state_controls,
                    crate::infra::page_state::browser_page_state_act,
                    crate::infra::page_state::browser_page_state_guard,
                    crate::infra::page_state::history::browser_view_history_save,
                    crate::infra::page_state::history::browser_view_history_load,
                    crate::infra::browser_sync::browser_sync_control_device,
                    crate::infra::browser_sync::browser_sync_lock,
                    crate::infra::browser_sync::browser_sync_set_frequency,
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
                    crate::infra::workspace_autopilot::agent_desktop_recent_audio,
                    crate::infra::workspace_autopilot::agent_control_yield,
                    crate::infra::workspace_autopilot::agent_control_island,
                    #[cfg(windows)]
                    crate::infra::desktop_overlays_windows::agent_desktop_island_press,
                    #[cfg(windows)]
                    crate::infra::desktop_overlays_windows::agent_desktop_overlay_state,
                    #[cfg(windows)]
                    crate::infra::agent_dock_windows::agent_dock_card,
                    #[cfg(windows)]
                    crate::infra::window_snap_windows::window_show_snap_layouts,
                    crate::infra::default_browser::app_take_launch_urls,
                    mac_rounded_corners::reveal_main_window,
                    mac_rounded_corners::enable_modern_window_style,
                    platform::plugins::mac_traffic_lights::set_traffic_lights_visible,
                    app_snapshot,
                    agents_device_snapshot,
                    infra::agent_files::agent_files_choose,
                    infra::agent_files::agent_files_prepare,
                    infra::agent_files::agent_files_apply,
                    infra::agent_files::agent_files_cancel,
                    infra::agent_files::agent_files_manifest,
                    infra::agent_files::agent_files_history,
                    infra::agent_files::agent_files_snapshot,
                    infra::agent_files::agent_files_undo,
                    infra::agent_files::agent_files_revoke,
                    agents_revoke_folder_scope,
                    agents_choose_folder_scope,
                    agents_list_scoped_files,
                    agents_prepare_scoped_document,
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    devices_start,
                    #[cfg(desktop)]
                    devices_stop,
                    #[cfg(desktop)]
                    devices_view,
                    #[cfg(desktop)]
                    devices_refresh,
                    #[cfg(desktop)]
                    devices_admit_self,
                    #[cfg(desktop)]
                    devices_request_approval,
                    #[cfg(desktop)]
                    devices_approval_status,
                    #[cfg(desktop)]
                    devices_pending_requests,
                    #[cfg(desktop)]
                    devices_approve_start,
                    #[cfg(desktop)]
                    devices_approve_status,
                    #[cfg(desktop)]
                    devices_approve_confirm,
                    #[cfg(desktop)]
                    devices_deny,
                    #[cfg(desktop)]
                    devices_remove,
                    #[cfg(desktop)]
                    devices_rename,
                    #[cfg(desktop)]
                    devices_set_policy,
                    #[cfg(desktop)]
                    devices_publish_folders,
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    device_sign_request,
                    #[cfg(desktop)]
                    device_sign_run_grants,
                    #[cfg(desktop)]
                    device_verify_job,
                    #[cfg(desktop)]
                    coding_engines_detect,
                    #[cfg(desktop)]
                    coding_runner_stop,
                    #[cfg(desktop)]
                    coding_route,
                    #[cfg(desktop)]
                    coding_project_remote,
                    #[cfg(desktop)]
                    coding_run_turn,
                    #[cfg(desktop)]
                    coding_runner_answer,
                    #[cfg(desktop)]
                    app::project_commands::project_choose,
                    #[cfg(desktop)]
                    app::project_commands::project_new,
                    #[cfg(desktop)]
                    app::project_commands::project_remove,
                    #[cfg(desktop)]
                    app::project_commands::project_publish,
                    #[cfg(desktop)]
                    app::project_commands::project_clone,
                    #[cfg(desktop)]
                    app::project_commands::project_git_diff,
                    #[cfg(desktop)]
                    app::checkpoint_commands::project_checkpoints,
                    #[cfg(desktop)]
                    app::checkpoint_commands::project_run_diff,
                    #[cfg(desktop)]
                    app::checkpoint_commands::project_undo,
                    #[cfg(desktop)]
                    app::checkpoint_commands::project_snapshot,
                    #[cfg(desktop)]
                    app::project_commands::project_legacy_flags,
                    #[cfg(desktop)]
                    app::project_commands::project_legacy_flags_done,
                    #[cfg(desktop)]
                    device_read_shared_file,
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    check_system,
                    save_authenticated_user,
                    save_verified_license,
                    sign_out_misty,
                    #[cfg(desktop)]
                    browser_webview_create,
                    infra::agent_workspace::agent_window_open,
                    infra::agent_workspace::agent_window_show,
                    infra::agent_dock::agent_dock_window,
                    infra::agent_dock::agent_dock_open,
                    infra::agent_dock::agent_dock_status,
                    infra::agent_dock::agent_dock_visibility,
                    infra::agent_dock::agent_dock_host_action,
                    infra::agent_dock::agent_tab_detach,
                    infra::agent_dock::agent_tab_attach,
                    infra::extension_popup::extension_popup_open,
                    infra::extension_popup::extension_popup_close,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_configure,
                    #[cfg(any(target_os = "macos", windows))]
                    voice::voice_dictation_configure,
                    #[cfg(any(target_os = "macos", windows))]
                    voice::voice_dictation_stop,
                    #[cfg(any(target_os = "macos", windows))]
                    voice::voice_dictation_insert,
                    #[cfg(any(target_os = "macos", windows))]
                    voice::voice_dictation_pill_hide,
                    #[cfg(any(target_os = "macos", windows))]
                    voice::voice_capture_sources,
                    #[cfg(any(target_os = "macos", windows))]
                    voice::voice_capture_start,
                    #[cfg(any(target_os = "macos", windows))]
                    voice::voice_capture_mute,
                    #[cfg(any(target_os = "macos", windows))]
                    voice::voice_capture_stop,
                    voice::tab_tap::voice_tab_capture_start,
                    voice::tab_tap::voice_tab_capture_stop,
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
                    infra::cursor_companion::cursor_companion_snap,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_capture_region,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::cursor_companion::cursor_companion_watch_clicks,
                    #[cfg(any(target_os = "macos", windows))]
                    infra::agent_workspace::agent_window_take_task,
                    infra::agent_workspace::agent_window_ack_task,
                    infra::agent_workspace::agent_window_task_receipt,
                    infra::agent_workspace::agent_foreground_queue,
                    infra::agent_workspace::agent_workspace_acquire,
                    #[cfg(desktop)]
                    infra::power_keep_awake::power_keep_awake,
                    infra::agent_workspace::agent_workspace_release,
                    infra::agent_workspace::agent_workspace_bind_scope,
                    #[cfg(desktop)]
                    infra::browser::browser_runtime_for_scope,
                    #[cfg(desktop)]
                    infra::browser::browser_agent_set_locked,
                    infra::agent_workspace::agent_browser_session_id,
                    #[cfg(desktop)]
                    crate::infra::browser::browser_context_menu_select,
                    #[cfg(desktop)]
                    crate::infra::browser::browser_webview_context_menu_at,
                    #[cfg(desktop)]
                    browser_shortcuts_update,
                    #[cfg(desktop)]
                    browser_webview_set_bounds,
                    #[cfg(desktop)]
                    browser_webview_capture_region,
                    browser_webview_preview_document,
                    #[cfg(target_os = "macos")]
                    infra::browser_macos::host_webview_capture_region,
                    #[cfg(desktop)]
                    browser_webview_reconcile,
                    #[cfg(desktop)]
                    browser_webview_set_theme,
                    #[cfg(desktop)]
                    browser_webview_set_pane_dim,
                    agent_action_confirm,
                    #[cfg(desktop)]
                    browser_webview_navigate,
                    #[cfg(desktop)]
                    browser_webview_back,
                    #[cfg(desktop)]
                    browser_webview_forward,
                    #[cfg(desktop)]
                    browser_webview_reload,
                    #[cfg(desktop)]
                    infra::browser_site_permissions::browser_site_info,
                    #[cfg(desktop)]
                    infra::browser_site_permissions::browser_site_permissions_set,
                    #[cfg(desktop)]
                    infra::browser_site_permissions::browser_site_permissions_list,
                    #[cfg(desktop)]
                    infra::browser_site_permissions::browser_site_permissions_reset,
                    #[cfg(desktop)]
                    infra::browser_site_zoom::browser_set_site_zoom_levels,
                    #[cfg(desktop)]
                    infra::browser_site_style::browser_set_site_styles,
                    #[cfg(desktop)]
                    infra::browser_site_style::browser_webview_pick_element,
                    #[cfg(desktop)]
                    infra::browser_night_light::browser_set_night_light,
                    browser_webview_set_zoom,
                    #[cfg(desktop)]
                    browser_webview_show,
                    browser_webview_held,
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
                    browser_webview_picture_in_picture,
                    #[cfg(desktop)]
                    browser_webview_media_playback,
                    browser_webview_media_action,
                    browser_webview_media_info,
                    #[cfg(desktop)]
                    browser_webview_reader_article,
                    #[cfg(desktop)]
                    browser_device_profile_delete,
                    #[cfg(desktop)]
                    browser_set_mouse_gestures,
                    #[cfg(desktop)]
                    browser_password_offer_respond,
                    #[cfg(desktop)]
                    browser_passwords_list,
                    #[cfg(desktop)]
                    browser_passwords_reveal,
                    #[cfg(desktop)]
                    browser_passwords_delete,
                    #[cfg(desktop)]
                    browser_passwords_save,
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
                    #[cfg(desktop)]
                    browser_import_discover,
                    #[cfg(desktop)]
                    browser_import_bookmarks,
                    #[cfg(desktop)]
                    browser_import_bookmarks_file,
                    #[cfg(desktop)]
                    browser_import_save_bookmarks,
                    #[cfg(desktop)]
                    browser_import_preview,
                    #[cfg(desktop)]
                    browser_import_history,
                    #[cfg(desktop)]
                    browser_import_settings,
                    #[cfg(desktop)]
                    browser_import_signins,
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
                    browser_webview_hide,
                    #[cfg(desktop)]
                    browser_webviews_hide_all,
                    #[cfg(desktop)]
                    browser_webviews_hide_except,
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
                    clipboard_snapshot,
                    clipboard_set_local,
                    clipboard_publish_shared,
                    clipboard_publish_image_bytes,
                    clipboard_apply_shared,
                    clipboard_shared_image_bytes,
                    clipboard_native_file_refs,
                    clipboard_write_file_bytes,
                    clipboard_write_file_refs,
                    devices_snapshot,
                    explorer_list_directory,
                    explorer_prepare_open_item,
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    #[cfg(desktop)]
                    navigation_names_snapshot,
                    navigation_names_update,
                    settings_snapshot,
                    settings_profile_state,
                    settings_profile_commit,
                    settings_save,
                    settings_launch_on_login_snapshot,
                    settings_apply_launch_on_login,
                    settings_default_browser_snapshot,
                    settings_request_default_browser,
                    shortcuts_snapshot,
                    crate::infra::kura::kura_installed,
                    crate::app::clipboard_commands::clipboard_cloud_view,
                    crate::app::clipboard_commands::clipboard_cloud_copy,
                    crate::app::clipboard_commands::clipboard_cloud_save,
                    crate::infra::kura::kura_open,
                    shortcuts_replace,
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
        .run(platform::app_lifecycle::run_event);
}
