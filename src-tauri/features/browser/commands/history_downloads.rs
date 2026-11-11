//! Browser commands for history downloads, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

#[cfg(desktop)]
pub(crate) use crate::browser::history_downloads::library::history::{
    __cmd__browser_history_clear, __tauri_command_name_browser_history_clear, browser_history_clear,
};
#[cfg(desktop)]
pub(crate) use crate::browser::history_downloads::library::{
    __cmd__browser_downloads_remove, __tauri_command_name_browser_downloads_remove,
    browser_downloads_remove,
};
