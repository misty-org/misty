//! Voice: dictation into any app and captures.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod audio_capture;
pub mod commands;
pub mod dictation;
pub mod hold_to_talk;
pub mod insert;
#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(target_os = "macos")]
pub(crate) mod macos;

// Glob re-exports carry the `__cmd__*` macros that #[tauri::command] generates
// beside each function; naming the functions alone leaves generate_handler! blind.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub use audio_capture::*;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub use dictation::session::*;
