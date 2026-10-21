//! Voice: dictation into any app, captures, and screen recordings.
//! Docs: docs/design/voice-memory/BRIEF.md.
#[cfg(any(target_os = "macos", windows))]
mod capture;
pub mod dictation;
pub mod insert;
#[cfg(any(target_os = "macos", windows))]
mod pill;
pub mod recording;
#[cfg(any(target_os = "macos", windows))]
mod session;
pub mod tab_tap;

// Glob re-exports carry the `__cmd__*` macros that #[tauri::command] generates
// beside each function; naming the functions alone leaves generate_handler! blind.
#[cfg(any(target_os = "macos", windows))]
pub use capture::*;
#[cfg(any(target_os = "macos", windows))]
pub use session::*;
