use std::collections::HashMap;
use std::path::{Path, PathBuf};

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

#[derive(Clone, Debug)]
pub struct HearingSpec {
    pub family: HearingFamily,
    pub dir: PathBuf,
    pub files: HashMap<String, String>,
}

#[derive(Clone, Debug)]
pub struct VadSpec {
    pub model: PathBuf,
}

#[derive(Clone, Debug)]
pub struct VoiceSpec {
    pub dir: PathBuf,
    pub files: HashMap<String, String>,
    pub speaker: i32,
}

pub(crate) fn file(dir: &Path, files: &HashMap<String, String>, role: &str) -> Option<String> {
    let names = files.get(role)?;
    let joined: Vec<String> = names
        .split(',')
        .map(|name| dir.join(name.trim()).to_string_lossy().into_owned())
        .collect();
    Some(joined.join(","))
}

pub(crate) fn threads() -> i32 {
    let cores = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2);
    cores.saturating_sub(1).clamp(1, 4) as i32
}
