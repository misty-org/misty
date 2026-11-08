//! Browser commands for extensions, named here so the command table can list them with their
//! hidden `__cmd__*` macros.

pub(crate) use crate::browser::extensions::install::{
    __cmd__extensions_commit, __cmd__extensions_prepare, __tauri_command_name_extensions_commit,
    __tauri_command_name_extensions_prepare, extensions_commit, extensions_prepare,
};
pub(crate) use crate::browser::extensions::popup::{
    __cmd__extension_popup_close, __cmd__extension_popup_open,
    __tauri_command_name_extension_popup_close, __tauri_command_name_extension_popup_open,
    extension_popup_close, extension_popup_open,
};
pub(crate) use crate::browser::extensions::records::{
    __cmd__profile_extensions_list, __tauri_command_name_profile_extensions_list,
    profile_extensions_list,
};
pub(crate) use crate::browser::extensions::runtime::{
    __cmd__extensions_action, __cmd__extensions_check_updates, __cmd__extensions_reconcile,
    __cmd__extensions_respond, __cmd__extensions_tab_created,
    __tauri_command_name_extensions_action, __tauri_command_name_extensions_check_updates,
    __tauri_command_name_extensions_reconcile, __tauri_command_name_extensions_respond,
    __tauri_command_name_extensions_tab_created, extensions_action, extensions_check_updates,
    extensions_reconcile, extensions_respond, extensions_tab_created,
};
pub(crate) use crate::browser::extensions::{
    __cmd__extensions_compat, __cmd__extensions_layout, __tauri_command_name_extensions_compat,
    __tauri_command_name_extensions_layout, extensions_compat, extensions_layout,
};
