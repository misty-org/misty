//! Where a model's files are, as the app hands them over from Misty's catalog: the folder its
//! package unpacked to and each file by its role (`files` in a catalog entry).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The model families the catalog's hearing entries name (`family`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HearingFamily {
    NemoTransducer,
    Qwen3Asr,
    Whisper,
    Moonshine,
    OmnilingualCtc,
}

impl HearingFamily {
    pub fn parse(name: &str) -> Option<Self> {
        Some(match name {
            "nemo_transducer" => Self::NemoTransducer,
            "qwen3_asr" => Self::Qwen3Asr,
            "whisper" => Self::Whisper,
            "moonshine" => Self::Moonshine,
            "omnilingual_ctc" => Self::OmnilingualCtc,
            _ => return None,
        })
    }
}

/// A speech recognition model on this computer.
#[derive(Clone, Debug)]
pub struct HearingSpec {
    pub family: HearingFamily,
    /// The folder the package unpacked to.
    pub dir: PathBuf,
    /// Each file by its role (`encoder`, `tokens`…), relative to `dir`.
    pub files: HashMap<String, String>,
}

/// The voice activity detector every hearing session uses (Silero VAD).
#[derive(Clone, Debug)]
pub struct VadSpec {
    pub model: PathBuf,
}

/// A voice on this computer: its model's files, and which of the model's speakers it is. The
/// model opens with `dir` and `files`; `speaker` is passed with each text.
#[derive(Clone, Debug)]
pub struct VoiceSpec {
    pub dir: PathBuf,
    pub files: HashMap<String, String>,
    pub speaker: i32,
}

/// One file of a model, as a path string sherpa-onnx takes; several comma-separated files keep
/// their commas (Kokoro's lexicons).
pub(crate) fn file(dir: &Path, files: &HashMap<String, String>, role: &str) -> Option<String> {
    let names = files.get(role)?;
    let joined: Vec<String> = names
        .split(',')
        .map(|name| dir.join(name.trim()).to_string_lossy().into_owned())
        .collect();
    Some(joined.join(","))
}

/// How many threads a model runs on: most of the computer, never all of it.
pub(crate) fn threads() -> i32 {
    let cores = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2);
    cores.saturating_sub(1).clamp(1, 4) as i32
}
