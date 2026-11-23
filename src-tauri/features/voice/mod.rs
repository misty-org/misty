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
mod share_audio;
pub mod speech;
pub mod speech_models;
pub mod speech_words;

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub use audio_capture::*;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
pub use dictation::session::*;
pub use share_audio::*;
