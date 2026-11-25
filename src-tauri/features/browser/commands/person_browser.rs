#[cfg(desktop)]
pub(crate) use crate::browser::agent_pages::page_tools::{
    __cmd__browser_webview_find,
    __tauri_command_name_browser_webview_find,
    browser_webview_find,
    __cmd__browser_webview_nav_state,
    __tauri_command_name_browser_webview_nav_state,
    browser_webview_nav_state,
    __cmd__browser_webview_set_zoom,
    __tauri_command_name_browser_webview_set_zoom,
    browser_webview_set_zoom,
};

#[cfg(desktop)]
pub(crate) use crate::browser::history_downloads::library::{
    __cmd__browser_download_open,
    __tauri_command_name_browser_download_open,
    browser_download_open,
    __cmd__browser_downloads_clear,
    __tauri_command_name_browser_downloads_clear,
    browser_downloads_clear,
    __cmd__browser_downloads_list,
    __tauri_command_name_browser_downloads_list,
    browser_downloads_list,
    __cmd__browser_history_clear,
    __tauri_command_name_browser_history_clear,
    browser_history_clear,
    __cmd__browser_history_recent,
    __tauri_command_name_browser_history_recent,
    browser_history_recent,
    __cmd__browser_history_record,
    __tauri_command_name_browser_history_record,
    browser_history_record,
    __cmd__browser_history_set_title,
    __tauri_command_name_browser_history_set_title,
    browser_history_set_title,
    __cmd__browser_history_suggest,
    __tauri_command_name_browser_history_suggest,
    browser_history_suggest,
};

#[cfg(desktop)]
pub(crate) use crate::browser::web_tabs::{
    __cmd__browser_search_suggest,
    __tauri_command_name_browser_search_suggest,
    browser_search_suggest,
    __cmd__browser_webview_print,
    __tauri_command_name_browser_webview_print,
    browser_webview_print,
    __cmd__browser_webview_save_page,
    __tauri_command_name_browser_webview_save_page,
    browser_webview_save_page,
    __cmd__browser_webview_inspect,
    __tauri_command_name_browser_webview_inspect,
    browser_webview_inspect,
    __cmd__browser_webview_picture_in_picture,
    __tauri_command_name_browser_webview_picture_in_picture,
    browser_webview_picture_in_picture,
    __cmd__browser_webview_page_text,
    __tauri_command_name_browser_webview_page_text,
    browser_webview_page_text,
    __cmd__browser_site_permission_answer,
    __tauri_command_name_browser_site_permission_answer,
    browser_site_permission_answer,
    __cmd__browser_site_permissions,
    __tauri_command_name_browser_site_permissions,
    browser_site_permissions,
    __cmd__browser_site_permission_set,
    __tauri_command_name_browser_site_permission_set,
    browser_site_permission_set,
};

#[cfg(desktop)]
pub(crate) use crate::browser::history_downloads::library::{
    __cmd__browser_history_forget,
    __tauri_command_name_browser_history_forget,
    browser_history_forget,
    __cmd__browser_history_list,
    __tauri_command_name_browser_history_list,
    browser_history_list,
};

#[cfg(desktop)]
pub(crate) use crate::browser::page_media::{
    __cmd__page_media_act,
    __tauri_command_name_page_media_act,
    page_media_act,
    __cmd__page_media_set_muted,
    __tauri_command_name_page_media_set_muted,
    page_media_set_muted,
};
