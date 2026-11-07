//! Voice: dictation into any app and captures.
#[cfg(any(target_os = "macos", windows))]
mod capture;
pub mod dictation;
pub mod insert;
#[cfg(target_os = "macos")]
mod insert_macos;
#[cfg(windows)]
mod insert_windows;
#[cfg(any(target_os = "macos", windows))]
mod pill;
#[cfg(any(target_os = "macos", windows))]
mod session;
#[cfg(any(target_os = "macos", windows))]
mod subtitles;
pub mod tab_tap;

// Glob re-exports carry the `__cmd__*` macros that #[tauri::command] generates
// beside each function; naming the functions alone leaves generate_handler! blind.
#[cfg(any(target_os = "macos", windows))]
pub use capture::*;
#[cfg(any(target_os = "macos", windows))]
pub use session::*;
#[cfg(any(target_os = "macos", windows))]
pub use subtitles::*;
