//! The voice feature's commands: dictation and captures. Glob re-exports carry
//! the `__cmd__*` macros that #[tauri::command] generates beside each function.

// Commands that live in the feature's other modules, named here so the command table can list them all
// from one place. `generate_handler!` needs each command's hidden macros beside it, so those are named too.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub(crate) use super::{
    __cmd__voice_capture_mute, __cmd__voice_capture_start, __cmd__voice_capture_stop,
    __cmd__voice_dictation_configure, __cmd__voice_dictation_insert,
    __cmd__voice_dictation_pill_hide, __cmd__voice_dictation_stop,
    __tauri_command_name_voice_capture_mute, __tauri_command_name_voice_capture_start,
    __tauri_command_name_voice_capture_stop, __tauri_command_name_voice_dictation_configure,
    __tauri_command_name_voice_dictation_insert, __tauri_command_name_voice_dictation_pill_hide,
    __tauri_command_name_voice_dictation_stop, voice_capture_mute, voice_capture_start,
    voice_capture_stop, voice_dictation_configure, voice_dictation_insert,
    voice_dictation_pill_hide, voice_dictation_stop,
};
#[cfg(desktop)]
pub(crate) use crate::voice::hold_to_talk::{
    __cmd__global_hotkey_signed_out, __tauri_command_name_global_hotkey_signed_out,
    global_hotkey_signed_out,
};
