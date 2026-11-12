//! Every command the app's own windows may invoke. `src-tauri/tauri-permissions/` says which window gets which,
//! and `app::trusted_windows::app_command_policy` holds windows to their exact labels.
use tauri::ipc::Invoke;
use tauri::Wry;

mod more_commands;

pub fn invoke_handler() -> impl Fn(Invoke<Wry>) -> bool + Send + Sync + 'static {
    let dispatch: Box<dyn Fn(Invoke<Wry>) -> bool + Send + Sync> =
        Box::new(more_commands::with_more_commands!(
            crate::account::commands::api_cache_get,
            crate::account::commands::api_cache_put,
            crate::account::commands::api_cache_delete_prefix,
            crate::account::commands::api_cache_clear,
            crate::browser::commands::browser_recovery_open,
            crate::browser::commands::browser_recovery_read,
            crate::browser::commands::browser_recovery_write,
            crate::browser::commands::browser_recovery_forget,
            crate::app::lifecycle::app_quit_confirmed,
            crate::account::commands::auth_session_capture,
            crate::account::commands::auth_session_restore,
            crate::account::commands::auth_session_forget,
            crate::account::commands::auth_http_start,
            crate::account::commands::auth_http_read,
            crate::account::commands::auth_http_cancel,
            crate::agents::commands::model_keys_saved,
            crate::agents::commands::model_keys_save,
            crate::agents::commands::model_keys_remove,
            crate::agents::commands::model_keys_add,
            crate::agents::commands::model_keys_models,
            crate::agents::commands::model_keys_openrouter_sign_in,
            crate::agents::commands::model_keys_chatgpt_status,
            crate::agents::commands::model_keys_chatgpt_sign_in,
            crate::agents::commands::model_keys_chatgpt_sign_out,
            crate::agents::commands::agent_runtime_call,
            crate::agents::commands::agent_runtime_voice_open,
            crate::agents::commands::agent_runtime_live_open,
            crate::agents::commands::agent_runtime_session_send,
            crate::agents::commands::agent_runtime_session_close,
            crate::agents::commands::misty_workspace_focused,
            crate::agents::commands::misty_screen_status,
            crate::agents::commands::misty_screen_capture,
            crate::agents::commands::agent_workspace_context,
            crate::agents::commands::agent_control_yield,
            crate::agents::commands::agent_control_island,
            #[cfg(windows)]
            crate::agents::commands::agent_desktop_island_press,
            #[cfg(windows)]
            crate::agents::commands::agent_desktop_overlay_state,
            #[cfg(windows)]
            crate::browser::commands::window_show_snap_layouts,
            #[cfg(windows)]
            crate::browser::commands::window_set_maximize_button,
            crate::app::macos_window_effects::mac_rounded_corners::reveal_main_window,
            crate::app::macos_window_effects::mac_rounded_corners::enable_modern_window_style,
            crate::app::macos_window_effects::mac_traffic_lights::set_traffic_lights_visible,
            crate::app::commands::app_snapshot,
            crate::agents::commands::agents_device_snapshot,
            crate::agents::commands::agents_list_scoped_files,
            crate::browser::commands::link_preview_fetch,
            crate::browser::commands::browser_site_icon,
            crate::agents::commands::agents_prepare_scoped_document,
            crate::agents::commands::tutor_pick_sources,
            crate::agents::commands::tutor_transcribe_sources,
            crate::agents::commands::tutor_overview_make,
            crate::agents::commands::tutor_overview_audio,
            crate::agents::commands::tutor_overview_delete,
            crate::agents::tutor_video::tutor_video_clip_make,
            crate::agents::tutor_video::tutor_video_clip,
            crate::agents::tutor_video::tutor_video_clip_delete,
            crate::agents::tutor_links::tutor_read_link,
            crate::agents::tutor_links::tutor_read_dropped,
            crate::agents::tutor_links::tutor_save_export,
            #[cfg(desktop)]
            crate::devices::commands::devices_start,
            #[cfg(desktop)]
            crate::devices::commands::devices_stop,
            #[cfg(desktop)]
            crate::devices::commands::devices_view,
            #[cfg(desktop)]
            crate::devices::commands::folders::devices_publish_folders,
            #[cfg(desktop)]
            crate::devices::commands::jobs::device_sign_request,
            #[cfg(desktop)]
            crate::devices::commands::jobs::device_sign_run_grants,
            #[cfg(desktop)]
            crate::devices::commands::jobs::device_verify_job,
            #[cfg(desktop)]
            crate::agents::commands::device_shell_job,
            #[cfg(desktop)]
            crate::agents::commands::device_shell_cancel,
            #[cfg(desktop)]
            crate::agents::commands::agents_forget_workspace,
            #[cfg(desktop)]
            crate::agents::commands::agents_share_folder,
            #[cfg(desktop)]
            crate::agents::commands::agents_forget_folder,
            crate::agents::commands::agents_allow_folder_changes,
            crate::agents::commands::agents_stop_folder_changes,
            crate::agents::commands::agents_adopt_folder_changes,
            #[cfg(desktop)]
            crate::devices::commands::jobs::device_read_shared_file,
            #[cfg(desktop)]
            crate::account::commands::check_system,
            crate::account::commands::save_authenticated_user,
            crate::account::commands::sign_out_misty,
            #[cfg(desktop)]
            crate::browser::commands::browser_webview_create,
            crate::browser::commands::diagnostic_log,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_configure,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::voice::commands::voice_dictation_configure,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::voice::commands::voice_dictation_stop,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::voice::commands::voice_dictation_insert,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::voice::commands::voice_dictation_pill_hide,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::voice::commands::voice_capture_start,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::voice::commands::voice_capture_mute,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::voice::commands::voice_capture_stop,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_interrupt,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_present,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_capture,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_bind_task,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_snapshot,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_snap,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_capture_region,
            #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
            crate::agents::commands::cursor_companion_watch_clicks,
            crate::agents::commands::agent_foreground_queue,
            crate::agents::commands::agent_workspace_acquire,
            #[cfg(desktop)]
            crate::agents::commands::power_keep_awake,
            crate::agents::commands::agent_workspace_release,
            crate::agents::commands::agent_workspace_bind_scope,
        ));
    move |invoke: Invoke<Wry>| {
        if !crate::app::trusted_windows::app_command_policy::allows(
            invoke.message.webview_ref().label(),
        ) {
            invoke
                .resolver
                .reject("This view cannot invoke Host commands.");
            return true;
        }
        dispatch(invoke)
    }
}
