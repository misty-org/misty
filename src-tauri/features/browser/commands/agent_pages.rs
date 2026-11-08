//! Browser commands for agent pages, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

pub(crate) use crate::browser::agent_pages::action_confirm::{
    __cmd__agent_action_confirm, __tauri_command_name_agent_action_confirm, agent_action_confirm,
};
#[cfg(desktop)]
pub(crate) use crate::browser::agent_pages::agent_control::{
    __cmd__browser_agent_execute_bounded, __cmd__browser_agent_execution_cancel,
    __cmd__browser_agent_execution_renew, __tauri_command_name_browser_agent_execute_bounded,
    __tauri_command_name_browser_agent_execution_cancel,
    __tauri_command_name_browser_agent_execution_renew, browser_agent_execute_bounded,
    browser_agent_execution_cancel, browser_agent_execution_renew,
};
pub(crate) use crate::browser::agent_pages::page_tools::media_tools::session::{
    __cmd__browser_webview_media_action, __cmd__browser_webview_media_context,
    __cmd__browser_webview_media_info, __tauri_command_name_browser_webview_media_action,
    __tauri_command_name_browser_webview_media_context,
    __tauri_command_name_browser_webview_media_info, browser_webview_media_action,
    browser_webview_media_context, browser_webview_media_info,
};
#[cfg(desktop)]
pub(crate) use crate::browser::agent_pages::page_tools::media_tools::{
    __cmd__browser_webview_media_playback, __cmd__browser_webview_picture_in_picture,
    __cmd__browser_webview_reader_article, __tauri_command_name_browser_webview_media_playback,
    __tauri_command_name_browser_webview_picture_in_picture,
    __tauri_command_name_browser_webview_reader_article, browser_webview_media_playback,
    browser_webview_picture_in_picture, browser_webview_reader_article,
};
#[cfg(desktop)]
pub(crate) use crate::browser::agent_pages::page_tools::{
    __cmd__browser_clear_website_data, __cmd__browser_webview_developer_tools,
    __cmd__browser_webview_find, __cmd__browser_webview_print, __cmd__browser_webview_save_page,
    __cmd__browser_webview_set_media_hold, __cmd__browser_webview_set_muted,
    __cmd__browser_webview_stop, __tauri_command_name_browser_clear_website_data,
    __tauri_command_name_browser_webview_developer_tools,
    __tauri_command_name_browser_webview_find, __tauri_command_name_browser_webview_print,
    __tauri_command_name_browser_webview_save_page,
    __tauri_command_name_browser_webview_set_media_hold,
    __tauri_command_name_browser_webview_set_muted, __tauri_command_name_browser_webview_stop,
    browser_clear_website_data, browser_webview_developer_tools, browser_webview_find,
    browser_webview_print, browser_webview_save_page, browser_webview_set_media_hold,
    browser_webview_set_muted, browser_webview_stop,
};
pub(crate) use crate::browser::pages::page_state::history::{
    __cmd__browser_view_history_load, __cmd__browser_view_history_save,
    __tauri_command_name_browser_view_history_load, __tauri_command_name_browser_view_history_save,
    browser_view_history_load, browser_view_history_save,
};
pub(crate) use crate::browser::pages::page_state::{
    __cmd__browser_page_state_capture, __cmd__browser_page_state_restore,
    __tauri_command_name_browser_page_state_capture,
    __tauri_command_name_browser_page_state_restore, browser_page_state_capture,
    browser_page_state_restore,
};
