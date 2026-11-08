//! Browser commands for history downloads, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

#[cfg(desktop)]
pub(crate) use crate::browser::history_downloads::library::history::{
    __cmd__browser_history_clear, __cmd__browser_history_delete, __cmd__browser_history_forget,
    __cmd__browser_history_query, __cmd__browser_history_record, __cmd__browser_history_set_title,
    __cmd__browser_history_suggest, __tauri_command_name_browser_history_clear,
    __tauri_command_name_browser_history_delete, __tauri_command_name_browser_history_forget,
    __tauri_command_name_browser_history_query, __tauri_command_name_browser_history_record,
    __tauri_command_name_browser_history_set_title, __tauri_command_name_browser_history_suggest,
    browser_history_clear, browser_history_delete, browser_history_forget, browser_history_query,
    browser_history_record, browser_history_set_title, browser_history_suggest,
};
#[cfg(desktop)]
pub(crate) use crate::browser::history_downloads::library::{
    __cmd__browser_download_cancel, __cmd__browser_download_open, __cmd__browser_download_reveal,
    __cmd__browser_downloads_list, __cmd__browser_downloads_progress,
    __cmd__browser_downloads_remove, __tauri_command_name_browser_download_cancel,
    __tauri_command_name_browser_download_open, __tauri_command_name_browser_download_reveal,
    __tauri_command_name_browser_downloads_list, __tauri_command_name_browser_downloads_progress,
    __tauri_command_name_browser_downloads_remove, browser_download_cancel, browser_download_open,
    browser_download_reveal, browser_downloads_list, browser_downloads_progress,
    browser_downloads_remove,
};
#[cfg(desktop)]
pub(crate) use crate::browser::import::{
    __cmd__browser_import_bookmarks, __cmd__browser_import_bookmarks_file,
    __cmd__browser_import_discover, __cmd__browser_import_history, __cmd__browser_import_preview,
    __cmd__browser_import_save_bookmarks, __cmd__browser_import_settings,
    __cmd__browser_import_signins, __tauri_command_name_browser_import_bookmarks,
    __tauri_command_name_browser_import_bookmarks_file,
    __tauri_command_name_browser_import_discover, __tauri_command_name_browser_import_history,
    __tauri_command_name_browser_import_preview,
    __tauri_command_name_browser_import_save_bookmarks,
    __tauri_command_name_browser_import_settings, __tauri_command_name_browser_import_signins,
    browser_import_bookmarks, browser_import_bookmarks_file, browser_import_discover,
    browser_import_history, browser_import_preview, browser_import_save_bookmarks,
    browser_import_settings, browser_import_signins,
};
