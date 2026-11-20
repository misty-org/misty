//! The voice feature's commands: dictation and captures. Glob re-exports carry
//! the `__cmd__*` macros that #[tauri::command] generates beside each function.

// Commands that live in the feature's other modules, named here so the command table can list them all
// from one place. `generate_handler!` needs each command's hidden macros beside it, so those are named too.
pub(crate) use super::speech::{
    __cmd__speech_copy_answer, __cmd__speech_listen_start, __cmd__speech_listen_stop,
    __cmd__speech_on_call, __cmd__speech_open_voice_settings, __cmd__speech_output_muted,
    __cmd__speech_reading_add,
    __cmd__speech_reading_end, __cmd__speech_reading_progress, __cmd__speech_reading_start,
    __cmd__speech_recognize_audio,
    __cmd__speech_recognize_file, __cmd__speech_say,
    __cmd__speech_sound_on, __cmd__speech_stop, __cmd__speech_stream_poll,
    __cmd__speech_stream_push, __cmd__speech_stream_start, __cmd__speech_stream_stop,
    __cmd__speech_support, __tauri_command_name_speech_copy_answer,
    __tauri_command_name_speech_listen_start, __tauri_command_name_speech_listen_stop,
    __tauri_command_name_speech_on_call, __tauri_command_name_speech_open_voice_settings,
    __tauri_command_name_speech_output_muted,
    __tauri_command_name_speech_reading_add, __tauri_command_name_speech_reading_end,
    __tauri_command_name_speech_reading_progress, __tauri_command_name_speech_reading_start,
    __tauri_command_name_speech_recognize_audio,
    __tauri_command_name_speech_recognize_file,
    __tauri_command_name_speech_say, __tauri_command_name_speech_sound_on,
    __tauri_command_name_speech_stop, __tauri_command_name_speech_stream_poll,
    __tauri_command_name_speech_stream_push, __tauri_command_name_speech_stream_start,
    __tauri_command_name_speech_stream_stop, __tauri_command_name_speech_support,
    speech_copy_answer, speech_listen_start, speech_listen_stop, speech_on_call,
    speech_open_voice_settings, speech_output_muted, speech_reading_add, speech_reading_end, speech_reading_progress,
    speech_reading_start, speech_recognize_audio,
    speech_recognize_file, speech_say,
    speech_sound_on, speech_stop, speech_stream_poll, speech_stream_push, speech_stream_start,
    speech_stream_stop, speech_support,
};
pub(crate) use super::speech_words::{
    __cmd__speech_recognize_audio_words, __tauri_command_name_speech_recognize_audio_words,
    speech_recognize_audio_words,
};
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
