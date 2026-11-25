use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HearingSpec {
    pub family: HearingFamily,
    pub dir: PathBuf,
    pub files: HashMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VadSpec {
    pub model: PathBuf,
}

