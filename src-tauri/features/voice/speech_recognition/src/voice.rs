//! A voice: text in, speech out, through an open voice model (Kokoro). The speech comes back as
//! samples, to play on this computer (`play`) or hand to a call as an audio track.

use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig,
    OfflineTtsModelConfig,
};

use crate::model::{file, threads, VoiceSpec};
use crate::reason;

/// Speech made from text: mono samples between -1 and 1 at `rate`.
#[derive(Clone, Debug, Default)]
pub struct Speech {
    pub samples: Vec<f32>,
    pub rate: u32,
}

/// An open voice model. One model holds many speakers (Kokoro's voices), so it is opened once
/// and each text names its speaker. It speaks one text at a time, from any thread.
pub struct Voice {
    tts: OfflineTts,
}

impl Voice {
    pub fn open(spec: &VoiceSpec) -> Result<Self, String> {
        let path = |role: &str| file(&spec.dir, &spec.files, role);
        let kokoro = OfflineTtsKokoroModelConfig {
            model: Some(path("model").ok_or_else(|| reason("voice"))?),
            voices: Some(path("voices").ok_or_else(|| reason("voice"))?),
            tokens: Some(path("tokens").ok_or_else(|| reason("voice"))?),
            lexicon: path("lexicon"),
            dict_dir: path("dict"),
            ..OfflineTtsKokoroModelConfig::default()
        };
        let config = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                kokoro,
                num_threads: threads(),
                provider: Some("cpu".into()),
                ..OfflineTtsModelConfig::default()
            },
            max_num_sentences: 1,
            // sherpa-onnx's own pause between sentences.
            silence_scale: 0.2,
            ..OfflineTtsConfig::default()
        };
        let tts = OfflineTts::create(&config).ok_or_else(|| reason("voice"))?;
        Ok(Self { tts })
    }

    /// Speaks `text` as `speaker` (the model's speaker id) at `speed` (1 is the voice's own pace).
    pub fn speak(&self, text: &str, speaker: i32, speed: f32) -> Result<Speech, String> {
        // sherpa-onnx takes the text as a C string, which can't hold a NUL.
        let text = text.replace('\0', " ");
        let text = text.as_str();
        let config = GenerationConfig {
            sid: speaker,
            speed: speed.clamp(0.5, 2.0),
            ..GenerationConfig::default()
        };
        let audio = self
            .tts
            .generate_with_config(text, &config, None::<fn(&[f32], f32) -> bool>)
            .ok_or_else(|| reason("voice"))?;
        Ok(Speech {
            samples: audio.samples().to_vec(),
            rate: audio.sample_rate().max(1) as u32,
        })
    }
}
