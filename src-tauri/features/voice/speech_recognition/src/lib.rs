//! Speech recognition on this computer, with no key and nothing sent anywhere by Misty: a
//! recorded file, or the microphone live. On macOS through Apple's Speech framework, called from
//! Rust through objc2, on-device wherever the language has an on-device model. Other systems
//! have no recognizer here yet, and say so. On macOS it also reads sentences aloud in a system
//! voice as they arrive ([`Speaker`]).
//!
//! The crate has no app framework coupling: callers own events and windows.

use serde::{Deserialize, Serialize};

/// What the microphone has been heard to say so far.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Heard {
    #[serde(default)]
    pub text: String,
    /// The recognizer is done: nothing more will come.
    #[serde(default, rename = "final")]
    pub done: bool,
    #[serde(default)]
    pub error: Option<String>,
}

/// A phrase recognized from fed audio, with its time in seconds from the stream's start.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Phrase {
    pub text: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    /// How sure the recognizer is of the words, 0 to 1; 0 when it didn't say (an unfinished
    /// phrase). Comparing it tells which of two languages a person spoke.
    #[serde(default)]
    pub confidence: f32,
}

/// What a fed stream has been heard to say: finished phrases, and the one still being heard.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct StreamHeard {
    #[serde(default)]
    pub segments: Vec<Phrase>,
    #[serde(default)]
    pub current: Option<Phrase>,
}

/// Why recognition couldn't run, in words for the person.
pub fn reason(code: &str) -> String {
    match code {
        "denied" => "Misty isn't allowed to recognize speech. Allow it in System Settings › Privacy & Security › Speech Recognition.".into(),
        "unavailable" => "Speech recognition isn't available for this language on this computer.".into(),
        "microphone" => "Misty couldn't open the microphone.".into(),
        "microphone_denied" => "Misty isn't allowed to use the microphone. Allow it in System Settings › Privacy & Security › Microphone.".into(),
        "unsupported" => "This computer has no speech recognition Misty can use.".into(),
        _ => "Speech recognition stopped before it finished.".into(),
    }
}

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{
    listen, recognize_file, recognize_file_phrases, stream, supported, Listening, Speaker, Streaming,
};

#[cfg(not(target_os = "macos"))]
mod unsupported;
#[cfg(not(target_os = "macos"))]
pub use unsupported::{
    listen, recognize_file, recognize_file_phrases, stream, supported, Listening, Speaker, Streaming,
};
