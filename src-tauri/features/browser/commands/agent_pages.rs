//! Browser commands for agent pages, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

pub(crate) use crate::browser::agent_pages::action_confirm::{
    __cmd__agent_action_confirm, __tauri_command_name_agent_action_confirm, agent_action_confirm,
};
#[cfg(desktop)]
pub(crate) use crate::browser::agent_pages::agent_control::{
    __cmd__browser_agent_execute_bounded, __cmd__browser_agent_execution_cancel,
    __tauri_command_name_browser_agent_execute_bounded,
    __tauri_command_name_browser_agent_execution_cancel, browser_agent_execute_bounded,
    browser_agent_execution_cancel,
};
#[cfg(desktop)]
pub(crate) use crate::browser::agent_pages::page_tools::{
    __cmd__browser_clear_website_data, __cmd__browser_webview_set_media_hold,
    __cmd__browser_webview_set_muted, __cmd__browser_webview_stop,
    __tauri_command_name_browser_clear_website_data,
    __tauri_command_name_browser_webview_set_media_hold,
    __tauri_command_name_browser_webview_set_muted, __tauri_command_name_browser_webview_stop,
    browser_clear_website_data, browser_webview_set_media_hold, browser_webview_set_muted,
    browser_webview_stop,
};
