//! Voice: dictation into any app, captures, and screen recordings.
//! Docs: docs/design/voice-memory/BRIEF.md.
#[cfg(any(target_os = "macos", windows))]
mod capture;
pub mod dictation;
pub mod insert;
pub mod recording;
pub mod tab_tap;
#[cfg(any(target_os = "macos", windows))]
mod pill;
#[cfg(any(target_os = "macos", windows))]
mod session;

// Glob re-exports carry the `__cmd__*` macros that #[tauri::command] generates
// beside each function; naming the functions alone leaves generate_handler! blind.
#[cfg(any(target_os = "macos", windows))]
pub use capture::*;
#[cfg(any(target_os = "macos", windows))]
pub use session::*;
