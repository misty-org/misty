//! Browser commands for app windows, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

#[cfg(windows)]
pub(crate) use crate::browser::app_windows::windows::snap::{
    __cmd__window_show_snap_layouts, __tauri_command_name_window_show_snap_layouts,
    window_show_snap_layouts,
};
#[cfg(windows)]
pub(crate) use crate::browser::app_windows::windows::snap_target::{
    __cmd__window_set_maximize_button, __tauri_command_name_window_set_maximize_button,
    window_set_maximize_button,
};
pub(crate) use crate::browser::app_windows::workspace_recovery::{
    __cmd__browser_recovery_forget, __cmd__browser_recovery_open, __cmd__browser_recovery_read,
    __cmd__browser_recovery_write, __tauri_command_name_browser_recovery_forget,
    __tauri_command_name_browser_recovery_open, __tauri_command_name_browser_recovery_read,
    __tauri_command_name_browser_recovery_write, browser_recovery_forget, browser_recovery_open,
    browser_recovery_read, browser_recovery_write,
};
pub(crate) use crate::browser::app_windows::{
    __cmd__profile_window_close, __cmd__profile_window_info, __cmd__profile_window_is_host,
    __cmd__profile_window_link_target, __cmd__profile_window_new, __cmd__profile_window_set_space,
    __cmd__profile_window_take_orphans, __tauri_command_name_profile_window_close,
    __tauri_command_name_profile_window_info, __tauri_command_name_profile_window_is_host,
    __tauri_command_name_profile_window_link_target, __tauri_command_name_profile_window_new,
    __tauri_command_name_profile_window_set_space,
    __tauri_command_name_profile_window_take_orphans, profile_window_close, profile_window_info,
    profile_window_is_host, profile_window_link_target, profile_window_new,
    profile_window_set_space, profile_window_take_orphans,
};
