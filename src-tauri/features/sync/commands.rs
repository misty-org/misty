//! The sync feature's commands: the vault and the clipboard. Glob re-exports carry the `__cmd__*` macros
//! that #[tauri::command] generates beside each function.

// Commands that live in the feature's other modules, named here so the command table can list them all
// from one place. `generate_handler!` needs each command's hidden macros beside it, so those are named too.
pub(crate) use crate::sync::clipboard::commands::{
    __cmd__clipboard_cloud_copy, __cmd__clipboard_cloud_paste, __cmd__clipboard_cloud_save,
    __cmd__clipboard_cloud_view, __cmd__clipboard_write_file_bytes,
    __tauri_command_name_clipboard_cloud_copy, __tauri_command_name_clipboard_cloud_paste,
    __tauri_command_name_clipboard_cloud_save, __tauri_command_name_clipboard_cloud_view,
    __tauri_command_name_clipboard_write_file_bytes, clipboard_cloud_copy, clipboard_cloud_paste,
    clipboard_cloud_save, clipboard_cloud_view, clipboard_write_file_bytes,
};
pub(crate) use crate::sync::vault::{
    __cmd__vault_change_password, __cmd__vault_create, __cmd__vault_decline, __cmd__vault_destroy,
    __cmd__vault_pause, __cmd__vault_remove_session, __cmd__vault_rename_session,
    __cmd__vault_resume, __cmd__vault_sessions, __cmd__vault_start, __cmd__vault_state,
    __cmd__vault_unlock, __cmd__vault_usage, __tauri_command_name_vault_change_password,
    __tauri_command_name_vault_create, __tauri_command_name_vault_decline,
    __tauri_command_name_vault_destroy, __tauri_command_name_vault_pause,
    __tauri_command_name_vault_remove_session, __tauri_command_name_vault_rename_session,
    __tauri_command_name_vault_resume, __tauri_command_name_vault_sessions,
    __tauri_command_name_vault_start, __tauri_command_name_vault_state,
    __tauri_command_name_vault_unlock, __tauri_command_name_vault_usage, vault_change_password,
    vault_create, vault_decline, vault_destroy, vault_pause, vault_remove_session,
    vault_rename_session, vault_resume, vault_sessions, vault_start, vault_state, vault_unlock,
    vault_usage,
};
