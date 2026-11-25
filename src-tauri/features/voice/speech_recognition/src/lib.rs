use serde::{Deserialize, Serialize};

mod model;
pub mod protocol;

#[cfg(feature = "client")]
mod client;
#[cfg(feature = "client")]
mod player;

#[cfg(feature = "client")]
pub use client::{
    decode_file, recognize_file, recognize_samples, resample, use_helper, Hearing, Launch,
    Recognizer,
};
pub use model::{HearingFamily, HearingSpec, VadSpec};
#[cfg(feature = "client")]
pub use player::{play, Playback};

pub const SAMPLE_RATE: i32 = 16_000;

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

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Clone, Debug, Default)]
pub struct Speech {
    pub samples: Vec<f32>,
    pub rate: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub enum HearingEvent {
    Started { input: String },
    Stopped { input: String },
    Heard { input: String, phrase: Phrase },
    Closed,
}

pub fn reason(code: &str) -> String {
    match code {
        "no_model" => "Speech isn't set up on this computer yet.".into(),
        "model" => {
            "The speech model couldn't be opened. Set it up again in Settings › Voice.".into()
        }
        "file" => "That recording couldn't be read.".into(),
        "output" => "Misty couldn't play sound on this computer.".into(),
        _ => "Speech stopped before it finished.".into(),
    }
}
