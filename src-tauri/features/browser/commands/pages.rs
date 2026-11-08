//! Browser commands for pages, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

#[cfg(desktop)]
pub(crate) use crate::browser::input::shortcuts::{
    __cmd__browser_shortcuts_update, __tauri_command_name_browser_shortcuts_update,
    browser_shortcuts_update,
};
#[cfg(target_os = "macos")]
pub(crate) use crate::browser::pages::macos::{
    __cmd__host_webview_capture_region, __tauri_command_name_host_webview_capture_region,
    host_webview_capture_region,
};
#[cfg(desktop)]
pub(crate) use crate::browser::pages::night_light::{
    __cmd__browser_set_night_light, __tauri_command_name_browser_set_night_light,
    browser_set_night_light,
};
#[cfg(desktop)]
pub(crate) use crate::browser::pages::pane_dim::{
    __cmd__browser_webview_set_pane_dim, __tauri_command_name_browser_webview_set_pane_dim,
    browser_webview_set_pane_dim,
};
#[cfg(windows)]
pub(crate) use crate::browser::pages::stacked_pages::{
    __cmd__browser_set_hidden_tab_sleep, __cmd__browser_webviews_show_only,
    __tauri_command_name_browser_set_hidden_tab_sleep,
    __tauri_command_name_browser_webviews_show_only, browser_set_hidden_tab_sleep,
    browser_webviews_show_only,
};
pub(crate) use crate::browser::{
    __cmd__browser_agent_execute, __cmd__browser_agent_grant_register,
    __cmd__browser_agent_grant_revoke, __cmd__browser_agent_set_locked,
    __cmd__browser_choose_download_directory, __cmd__browser_context_menu_select,
    __cmd__browser_runtime_for_scope, __cmd__browser_set_download_directory,
    __cmd__browser_set_download_prompt, __cmd__browser_tab_download_open,
    __cmd__browser_webview_await_load, __cmd__browser_webview_back, __cmd__browser_webview_close,
    __cmd__browser_webview_context_menu_at, __cmd__browser_webview_create,
    __cmd__browser_webview_forward, __cmd__browser_webview_held, __cmd__browser_webview_hide,
    __cmd__browser_webview_navigate, __cmd__browser_webview_picture,
    __cmd__browser_webview_preview_document, __cmd__browser_webview_reconcile,
    __cmd__browser_webview_reload, __cmd__browser_webview_restore_focus,
    __cmd__browser_webview_set_bounds, __cmd__browser_webview_set_theme,
    __cmd__browser_webview_set_zoom, __cmd__browser_webview_show, __cmd__browser_webview_sleep,
    __cmd__browser_webviews_close_except, __cmd__browser_webviews_hide_all,
    __cmd__browser_webviews_hide_except, __cmd__browser_webviews_park_all,
    __cmd__browser_webviews_set_notice_rects, __cmd__browser_webviews_set_overlay_active,
    __cmd__browser_webviews_set_pointer_tracking, __cmd__browser_webviews_set_status_bubble,
    __tauri_command_name_browser_agent_execute, __tauri_command_name_browser_agent_grant_register,
    __tauri_command_name_browser_agent_grant_revoke, __tauri_command_name_browser_agent_set_locked,
    __tauri_command_name_browser_choose_download_directory,
    __tauri_command_name_browser_context_menu_select,
    __tauri_command_name_browser_runtime_for_scope,
    __tauri_command_name_browser_set_download_directory,
    __tauri_command_name_browser_set_download_prompt,
    __tauri_command_name_browser_tab_download_open,
    __tauri_command_name_browser_webview_await_load, __tauri_command_name_browser_webview_back,
    __tauri_command_name_browser_webview_close,
    __tauri_command_name_browser_webview_context_menu_at,
    __tauri_command_name_browser_webview_create, __tauri_command_name_browser_webview_forward,
    __tauri_command_name_browser_webview_held, __tauri_command_name_browser_webview_hide,
    __tauri_command_name_browser_webview_navigate, __tauri_command_name_browser_webview_picture,
    __tauri_command_name_browser_webview_preview_document,
    __tauri_command_name_browser_webview_reconcile, __tauri_command_name_browser_webview_reload,
    __tauri_command_name_browser_webview_restore_focus,
    __tauri_command_name_browser_webview_set_bounds,
    __tauri_command_name_browser_webview_set_theme, __tauri_command_name_browser_webview_set_zoom,
    __tauri_command_name_browser_webview_show, __tauri_command_name_browser_webview_sleep,
    __tauri_command_name_browser_webviews_close_except,
    __tauri_command_name_browser_webviews_hide_all,
    __tauri_command_name_browser_webviews_hide_except,
    __tauri_command_name_browser_webviews_park_all,
    __tauri_command_name_browser_webviews_set_notice_rects,
    __tauri_command_name_browser_webviews_set_overlay_active,
    __tauri_command_name_browser_webviews_set_pointer_tracking,
    __tauri_command_name_browser_webviews_set_status_bubble, browser_agent_execute,
    browser_agent_grant_register, browser_agent_grant_revoke, browser_agent_set_locked,
    browser_choose_download_directory, browser_context_menu_select, browser_runtime_for_scope,
    browser_set_download_directory, browser_set_download_prompt, browser_tab_download_open,
    browser_webview_await_load, browser_webview_back, browser_webview_close,
    browser_webview_context_menu_at, browser_webview_create, browser_webview_forward,
    browser_webview_held, browser_webview_hide, browser_webview_navigate, browser_webview_picture,
    browser_webview_preview_document, browser_webview_reconcile, browser_webview_reload,
    browser_webview_restore_focus, browser_webview_set_bounds, browser_webview_set_theme,
    browser_webview_set_zoom, browser_webview_show, browser_webview_sleep,
    browser_webviews_close_except, browser_webviews_hide_all, browser_webviews_hide_except,
    browser_webviews_park_all, browser_webviews_set_notice_rects,
    browser_webviews_set_overlay_active, browser_webviews_set_pointer_tracking,
    browser_webviews_set_status_bubble,
};
#[cfg(not(windows))]
pub(crate) use crate::browser::{
    __cmd__browser_set_hidden_tab_sleep, __cmd__browser_webviews_show_only,
    __tauri_command_name_browser_set_hidden_tab_sleep,
    __tauri_command_name_browser_webviews_show_only, browser_set_hidden_tab_sleep,
    browser_webviews_show_only,
};
