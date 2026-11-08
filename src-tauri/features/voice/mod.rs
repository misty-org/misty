//! Voice: dictation into any app and captures.
#[cfg(any(target_os = "macos", windows))]
mod audio_capture;
pub mod commands;
pub mod dictation;
pub mod hold_to_talk;
pub mod insert;
#[cfg(any(target_os = "macos", windows))]
mod live_subtitles;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
pub mod tab_audio;

// Glob re-exports carry the `__cmd__*` macros that #[tauri::command] generates
// beside each function; naming the functions alone leaves generate_handler! blind.
#[cfg(any(target_os = "macos", windows))]
pub use audio_capture::*;
#[cfg(any(target_os = "macos", windows))]
pub use dictation::session::*;
#[cfg(any(target_os = "macos", windows))]
pub use live_subtitles::*;
