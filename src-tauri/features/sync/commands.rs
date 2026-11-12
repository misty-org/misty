//! The sync feature's commands: the clipboard. Glob re-exports carry the `__cmd__*` macros
//! that #[tauri::command] generates beside each function.

// Commands that live in the feature's other modules, named here so the command table can list them all
// from one place. `generate_handler!` needs each command's hidden macros beside it, so those are named too.
pub(crate) use crate::sync::clipboard::commands::{
    __cmd__clipboard_write_file_bytes, __tauri_command_name_clipboard_write_file_bytes,
    clipboard_write_file_bytes,
};
