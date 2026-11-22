//! Speech on this computer through open models, with no key and nothing sent anywhere: hearing
//! (voice activity detection, then a speech recognition model), recorded files, and speaking in
//! a voice. Every model runs through sherpa-onnx (Apache-2.0) on the CPU, the same on macOS,
//! Windows and Linux. Which models there are, and where they come from, is Misty's catalog
//! (`misty-registry`); the app downloads them and hands this crate their files.
//!
//! The crate has no app framework coupling: callers own events, windows and model files.

use serde::{Deserialize, Serialize};

mod decode;
mod file;
mod hearing;
mod model;
mod player;
mod recognizer;
mod voice;

pub use decode::{decode_file, resample, SAMPLE_RATE};
pub use file::{recognize_file, recognize_samples};
pub use hearing::{Hearing, HearingEvent};
pub use model::{HearingFamily, HearingSpec, VadSpec, VoiceSpec};
pub use player::{play, Playback};
pub use recognizer::Recognizer;
pub use voice::{Speech, Voice};

/// A phrase recognized from audio, with its time in seconds from the audio's start, and its
/// words with theirs when the model times its tokens.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Phrase {
    pub text: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<Word>,
}

/// One word and when it was said, in seconds from the audio's start.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// Why speech couldn't run, in words for the person.
pub fn reason(code: &str) -> String {
    match code {
        "no_model" => "Speech isn't set up on this computer yet.".into(),
        "model" => "The speech model couldn't be opened. Set it up again in Settings › Voice.".into(),
        "voice" => "The voice couldn't be opened. Set it up again in Settings › Voice.".into(),
        "file" => "That recording couldn't be read.".into(),
        "output" => "Misty couldn't play sound on this computer.".into(),
        _ => "Speech stopped before it finished.".into(),
    }
}
