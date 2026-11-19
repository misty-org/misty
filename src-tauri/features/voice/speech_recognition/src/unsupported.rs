//! Systems with no recognizer here yet: every call says so.

use crate::{reason, Heard, Phrase, StreamHeard};

pub fn supported() -> bool {
    false
}

pub fn recognize_file(_path: &str, _locale: Option<&str>) -> Result<String, String> {
    Err(reason("unsupported"))
}

pub fn recognize_file_phrases(_path: &str, _locale: Option<&str>) -> Result<Vec<Phrase>, String> {
    Err(reason("unsupported"))
}

pub struct Listening;

impl Listening {
    pub fn heard(&self) -> Heard {
        Heard::default()
    }

    pub fn stop(self) -> Heard {
        Heard::default()
    }
}

pub fn listen(_locale: Option<&str>) -> Result<Listening, String> {
    Err(reason("unsupported"))
}

pub struct Streaming;

impl Streaming {
    pub fn push(&self, _pcm: &[i16]) {}

    pub fn heard(&self) -> StreamHeard {
        StreamHeard::default()
    }

    pub fn stop(self) -> StreamHeard {
        StreamHeard::default()
    }
}

pub fn stream(_locale: Option<&str>) -> Result<Streaming, String> {
    Err(reason("unsupported"))
}

/// No system voice here reads a queue of sentences; callers speak each one on its own instead.
pub struct Speaker;

impl Speaker {
    pub fn new(_voice: Option<&str>, _pace: f64) -> Result<Self, String> {
        Err("unsupported".into())
    }

    pub fn say(&self, _text: &str) {}

    pub fn busy(&self) -> bool {
        false
    }

    pub fn started(&self) -> u32 {
        0
    }
}
