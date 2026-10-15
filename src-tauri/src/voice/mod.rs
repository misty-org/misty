//! Voice: dictation into any app, and (later) captures and recordings.
//! Docs: docs/design/voice-memory/BRIEF.md.
pub mod dictation;
pub mod insert;
#[cfg(any(target_os = "macos", windows))]
mod pill;
#[cfg(any(target_os = "macos", windows))]
mod session;

#[cfg(any(target_os = "macos", windows))]
pub use session::{
    voice_dictation_configure, voice_dictation_insert, voice_dictation_pill_hide, voice_dictation_stop, DictationState,
};
