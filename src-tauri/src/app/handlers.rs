//! Every command the app's own windows may invoke. `src-tauri/sandbox/` says which window gets which,
//! and `platform::app_command_policy` holds windows to their exact labels.
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
            crate::infra::account::api_cache::api_cache_get,
            crate::infra::account::api_cache::api_cache_put,
            crate::infra::account::api_cache::api_cache_delete_prefix,
            crate::infra::account::api_cache::api_cache_clear,
            crate::infra::workspace_recovery::browser_recovery_open,
            crate::infra::workspace_recovery::browser_recovery_read,
            crate::infra::workspace_recovery::browser_recovery_write,
            crate::infra::workspace_recovery::browser_recovery_forget,
            crate::platform::app_lifecycle::app_quit_confirmed,
            crate::infra::browser::page_state::browser_page_state_capture,
            crate::infra::browser::page_state::browser_page_state_restore,
            crate::infra::browser::page_state::history::browser_view_history_save,
            crate::infra::browser::page_state::history::browser_view_history_load,
            crate::infra::account::session::auth_session_capture,
            crate::infra::account::session::auth_session_restore,
            crate::infra::account::session::auth_session_forget,
            crate::infra::account::http::auth_http_start,
            crate::infra::account::http::auth_http_read,
            crate::infra::account::http::auth_http_cancel,
            crate::infra::models::model_keys_saved,
            crate::infra::models::model_keys_save,
            crate::infra::models::model_keys_remove,
            crate::infra::models::keys::model_keys_add,
            crate::infra::models::keys::model_keys_models,
            crate::infra::models::keys::model_keys_openrouter_sign_in,
            crate::infra::models::chatgpt::model_keys_chatgpt_status,
            crate::infra::models::chatgpt::model_keys_chatgpt_sign_in,
            crate::infra::models::chatgpt::model_keys_chatgpt_sign_out,
            crate::infra::agent_runtime::calls::agent_runtime_deliver,
            crate::infra::agent_runtime::calls::agent_runtime_call,
            crate::infra::agent_runtime::live::agent_runtime_voice_open,
            crate::infra::agent_runtime::live::agent_runtime_live_open,
            crate::infra::agent_runtime::live::agent_runtime_session_send,
            crate::infra::agent_runtime::live::agent_runtime_session_close,
            crate::infra::misty_context::misty_workspace_focused,
            crate::infra::misty_context::misty_screen_status,
            crate::infra::misty_context::misty_screen_capture,
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
            crate::app::commands::agents_list_scoped_files,
            crate::infra::link_preview::link_preview_fetch,
            crate::infra::site_icon::browser_site_icon,
            crate::app::commands::agents_prepare_scoped_document,
            #[cfg(desktop)]
            crate::app::device_commands::devices_start,
            #[cfg(desktop)]
            crate::app::device_commands::devices_stop,
            #[cfg(desktop)]
            crate::app::device_commands::devices_view,
            #[cfg(desktop)]
            crate::app::device_admission_commands::devices_publish_folders,
            #[cfg(desktop)]
            crate::app::device_job_commands::device_sign_request,
            #[cfg(desktop)]
            crate::app::device_job_commands::device_sign_run_grants,
            #[cfg(desktop)]
            crate::app::device_job_commands::device_verify_job,
            #[cfg(desktop)]
            crate::app::shell_commands::device_shell_job,
            #[cfg(desktop)]
            crate::app::shell_commands::device_shell_cancel,
            #[cfg(desktop)]
            crate::app::shell_commands::agents_forget_workspace,
            #[cfg(desktop)]
            crate::app::shared_folder_commands::agents_share_folder,
            #[cfg(desktop)]
            crate::app::shared_folder_commands::agents_forget_folder,
            crate::app::shared_folder_commands::agents_allow_folder_changes,
            crate::app::shared_folder_commands::agents_stop_folder_changes,
            crate::app::shared_folder_commands::agents_adopt_folder_changes,
            #[cfg(desktop)]
            crate::app::device_job_commands::device_read_shared_file,
            #[cfg(desktop)]
            crate::infra::misty::check_system,
            crate::infra::misty::save_authenticated_user,
            crate::infra::misty::sign_out_misty,
            #[cfg(desktop)]
            crate::infra::browser::browser_webview_create,
            crate::infra::profile_windows::diagnostic_log,
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
            crate::voice::voice_subtitles_show,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_subtitles_hide,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_subtitles_export,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_capture_sources,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_capture_start,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_capture_mute,
            #[cfg(any(target_os = "macos", windows))]
            crate::voice::voice_capture_stop,
            crate::voice::tab_tap::voice_tab_capture_start,
            crate::voice::tab_tap::voice_tab_capture_stop,
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
        if !crate::platform::app_command_policy::allows(invoke.message.webview_ref().label()) {
            invoke
                .resolver
                .reject("This view cannot invoke Host commands.");
            return true;
        }
        dispatch(invoke)
    }
}
