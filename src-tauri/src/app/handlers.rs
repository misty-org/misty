//! Every command the app's own windows may invoke, behind the per-window policy
//! in `platform::app_command_policy`.
use tauri::ipc::Invoke;
use tauri::Wry;

mod more_commands;

pub fn invoke_handler() -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    let dispatch: Box<dyn Fn(Invoke<Wry>) -> bool + Send + Sync> =
        Box::new(more_commands::with_more_commands!(
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
            crate::infra::account::api_cache::api_cache_get,
            crate::infra::account::api_cache::api_cache_put,
            crate::infra::account::api_cache::api_cache_delete_prefix,
            crate::infra::account::api_cache::api_cache_clear,
            crate::infra::workspace_recovery::browser_recovery_open,
            crate::infra::workspace_recovery::browser_recovery_read,
            crate::infra::workspace_recovery::browser_recovery_write,
            crate::infra::workspace_recovery::browser_recovery_forget,
            crate::platform::app_lifecycle::app_quit_confirmed,
            crate::infra::browser_sync::account_login_credential,
            crate::infra::browser_sync::account_check_password,
            crate::infra::browser_sync::browser_sync_use_account_password,
            crate::infra::browser_sync::browser_sync_setup,
            crate::infra::browser_sync::browser_sync_connect,
            crate::infra::browser_sync::browser_sync_state,
            crate::infra::browser_sync::browser_sync_account_feed,
            crate::infra::browser_sync::browser_sync_edit,
            crate::infra::browser_sync::browser_sync_activate,
            crate::infra::browser_sync::browser_sync_claim,
            crate::infra::browser_sync::browser_sync_flush,
            crate::infra::browser_sync::browser_sync_rename_device,
            crate::infra::browser::page_state::browser_page_state_capture,
            crate::infra::browser::page_state::browser_page_state_restore,
            crate::infra::browser::page_state::browser_page_state_controls,
            crate::infra::browser::page_state::browser_page_state_act,
            crate::infra::browser::page_state::browser_page_state_guard,
            crate::infra::browser::page_state::history::browser_view_history_save,
            crate::infra::browser::page_state::history::browser_view_history_load,
            crate::infra::browser_sync::browser_sync_control_device,
            crate::infra::browser_sync::browser_sync_lock,
            crate::infra::browser_sync::browser_sync_set_frequency,
            crate::infra::browser_sync::browser_sync_forget_key,
            crate::infra::browser_sync::browser_sync_delete_vault,
            crate::infra::browser_sync::browser_sync_space_window,
            crate::infra::browser_sync::browser_sync_space_sites,
            crate::infra::browser_sync::browser_sync_set_space_sites,
            crate::infra::account::cookies::auth_cookie_capture,
            crate::infra::account::cookies::auth_cookie_restore,
            crate::infra::account::cookies::auth_cookie_forget,
            crate::infra::account::http::auth_http_start,
            crate::infra::account::http::auth_http_read,
            crate::infra::account::http::auth_http_cancel,
            crate::infra::misty_context::misty_workspace_focused,
            crate::infra::misty_context::misty_screen_status,
            crate::infra::misty_context::misty_screen_capture,
            crate::infra::screen_memory::screen_memory_status,
            crate::infra::screen_memory::screen_memory_start,
            crate::infra::screen_memory::screen_memory_stop,
            crate::infra::workspace_autopilot::agent_workspace_context,
            crate::infra::workspace_autopilot::agent_control_yield,
            crate::infra::workspace_autopilot::agent_control_island,
            #[cfg(windows)]
            crate::infra::desktop_overlays_windows::agent_desktop_island_press,
            #[cfg(windows)]
            crate::infra::desktop_overlays_windows::agent_desktop_overlay_state,
            #[cfg(windows)]
            crate::infra::window_snap_windows::window_show_snap_layouts,
            #[cfg(windows)]
            crate::infra::window_snap_target_windows::window_set_maximize_button,
            crate::infra::default_browser::app_take_launch_urls,
            crate::platform::plugins::mac_rounded_corners::reveal_main_window,
            crate::platform::plugins::mac_rounded_corners::enable_modern_window_style,
            crate::platform::plugins::mac_traffic_lights::set_traffic_lights_visible,
            crate::app::commands::app_snapshot,
            crate::app::commands::agents_device_snapshot,
            crate::infra::agents::files::agent_files_choose,
            crate::infra::agents::files::agent_files_prepare,
            crate::infra::agents::files::agent_files_apply,
            crate::infra::agents::files::agent_files_cancel,
            crate::infra::agents::files::agent_files_history,
            crate::infra::agents::files::agent_files_snapshot,
            crate::infra::agents::files::agent_files_undo,
            crate::infra::agents::files::agent_files_revoke,
            crate::app::commands::agents_list_scoped_files,
            crate::infra::agents::web_fetch::agents_web_fetch,
            crate::infra::link_preview::link_preview_fetch,
            crate::app::commands::agents_prepare_scoped_document,
            #[cfg(desktop)]
            crate::app::device_commands::devices_start,
            #[cfg(desktop)]
            crate::app::device_commands::devices_stop,
            #[cfg(desktop)]
            crate::app::device_commands::devices_view,
            #[cfg(desktop)]
            crate::app::device_commands::devices_refresh,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_admit_self,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_request_approval,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_approval_status,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_pending_requests,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_approve_start,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_approve_status,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_approve_confirm,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_deny,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_remove,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_rename,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_set_policy,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_publish_folders,
            #[cfg(desktop)]
            crate::app::device_job_commands::device_sign_request,
            #[cfg(desktop)]
            crate::app::device_job_commands::device_sign_run_grants,
            #[cfg(desktop)]
            crate::app::device_job_commands::device_verify_job,
            #[cfg(desktop)]
            crate::app::runner_commands::coding_engines_detect,
            #[cfg(desktop)]
            crate::app::runner_commands::coding_route,
            #[cfg(desktop)]
            crate::app::runner_commands::coding_project_remote,
            #[cfg(desktop)]
            crate::app::runner_commands::coding_run_turn,
            #[cfg(desktop)]
            crate::app::runner_commands::coding_runner_answer,
            #[cfg(desktop)]
            crate::app::project_commands::project_choose,
            #[cfg(desktop)]
            crate::app::project_commands::project_new,
            #[cfg(desktop)]
            crate::app::project_commands::project_remove,
            #[cfg(desktop)]
            crate::app::project_commands::project_publish,
            #[cfg(desktop)]
            crate::app::project_commands::project_clone,
            #[cfg(desktop)]
            crate::app::project_commands::project_git_diff,
            #[cfg(desktop)]
            crate::app::checkpoint_commands::project_checkpoints,
            #[cfg(desktop)]
            crate::app::checkpoint_commands::project_run_diff,
            #[cfg(desktop)]
            crate::app::checkpoint_commands::project_undo,
            #[cfg(desktop)]
            crate::app::checkpoint_commands::project_snapshot,
            #[cfg(desktop)]
            crate::app::project_commands::project_legacy_flags,
            #[cfg(desktop)]
            crate::app::project_commands::project_legacy_flags_done,
            #[cfg(desktop)]
            crate::app::device_job_commands::device_read_shared_file,
            #[cfg(desktop)]
            crate::infra::misty::check_system,
            crate::infra::misty::save_authenticated_user,
            crate::infra::misty::sign_out_misty,
            #[cfg(desktop)]
            crate::infra::browser::browser_webview_create,
            crate::infra::space_windows::diagnostic_log,
            crate::infra::extensions::popup::extension_popup_open,
            crate::infra::extensions::popup::extension_popup_close,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_configure,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_dictation_configure,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_dictation_stop,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_dictation_insert,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_dictation_pill_hide,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_capture_start,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_capture_mute,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_capture_stop,
            crate::voice::tab_tap::voice_tab_capture_start,
            crate::voice::tab_tap::voice_tab_capture_stop,
            crate::voice::recording::voice_recording_start,
            crate::voice::recording::voice_recording_stop,
            crate::voice::recording::voice_recording_discard,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_interrupt,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_present,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_capture,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_bind_task,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_snapshot,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_snap,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_capture_region,
            #[cfg(any(target_os = "macos", windows))]
            crate::infra::cursor_companion::cursor_companion_watch_clicks,
            crate::infra::agents::workspace::agent_foreground_queue,
            crate::infra::agents::workspace::agent_workspace_acquire,
            #[cfg(desktop)]
            crate::infra::power_keep_awake::power_keep_awake,
            crate::infra::agents::workspace::agent_workspace_release,
            crate::infra::agents::workspace::agent_workspace_bind_scope,
        ));
    move |invoke: Invoke<Wry>| {
        if !crate::platform::app_command_policy::allows(
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
}
