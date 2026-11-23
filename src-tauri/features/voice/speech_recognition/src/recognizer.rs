use sherpa_onnx::{
    OfflineMoonshineModelConfig, OfflineOmnilingualAsrCtcModelConfig, OfflineQwen3ASRModelConfig,
    OfflineRecognizer, OfflineRecognizerConfig, OfflineRecognizerResult,
    OfflineTransducerModelConfig, OfflineWhisperModelConfig,
};

use crate::decode::SAMPLE_RATE;
use crate::model::{file, threads, HearingFamily, HearingSpec};
use crate::{reason, Phrase, Word};

pub struct Recognizer {
    inner: OfflineRecognizer,
}

impl Recognizer {
    pub fn open(spec: &HearingSpec, language: Option<&str>) -> Result<Self, String> {
        let config = config(spec, language).ok_or_else(|| reason("model"))?;
        let inner = OfflineRecognizer::create(&config).ok_or_else(|| reason("model"))?;
        Ok(Self { inner })
    }

    pub fn recognize(&self, samples: &[f32], offset: f64) -> Phrase {
        let end = offset + samples.len() as f64 / SAMPLE_RATE as f64;
        let stream = self.inner.create_stream();
        stream.accept_waveform(SAMPLE_RATE, samples);
        self.inner.decode(&stream);
        let Some(result) = stream.get_result() else {
            return Phrase {
                start: offset,
                end,
                ..Phrase::default()
            };
        };
        let text = result.text.trim().to_string();
        let words = words(&result, offset, end);
        Phrase {
            text,
            start: offset,
            end,
            words,
        }
    }
}

fn config(spec: &HearingSpec, language: Option<&str>) -> Option<OfflineRecognizerConfig> {
    let path = |role: &str| file(&spec.dir, &spec.files, role);
    let mut config = OfflineRecognizerConfig::default();
    let model = &mut config.model_config;
    model.num_threads = threads();
    model.provider = Some("cpu".into());
    match spec.family {
        HearingFamily::NemoTransducer => {
            model.transducer = OfflineTransducerModelConfig {
                encoder: Some(path("encoder")?),
                decoder: Some(path("decoder")?),
                joiner: Some(path("joiner")?),
            };
            model.tokens = Some(path("tokens")?);
            model.model_type = Some("nemo_transducer".into());
        }
        HearingFamily::Whisper => {
            model.whisper = OfflineWhisperModelConfig {
                encoder: Some(path("encoder")?),
                decoder: Some(path("decoder")?),
                language: Some(language.unwrap_or("").to_string()),
                task: Some("transcribe".into()),
                ..OfflineWhisperModelConfig::default()
            };
            model.tokens = Some(path("tokens")?);
        }
        HearingFamily::Moonshine => {
            model.moonshine = OfflineMoonshineModelConfig {
                encoder: Some(path("encoder")?),
                merged_decoder: Some(path("merged_decoder")?),
                ..OfflineMoonshineModelConfig::default()
            };
            model.tokens = Some(path("tokens")?);
        }
        HearingFamily::Qwen3Asr => {
            model.qwen3_asr = OfflineQwen3ASRModelConfig {
                conv_frontend: Some(path("conv_frontend")?),
                encoder: Some(path("encoder")?),
                decoder: Some(path("decoder")?),
                tokenizer: Some(path("tokenizer")?),
                ..OfflineQwen3ASRModelConfig::default()
            };
        }
        HearingFamily::OmnilingualCtc => {
            model.omnilingual = OfflineOmnilingualAsrCtcModelConfig {
                model: Some(path("model")?),
            };
            model.tokens = Some(path("tokens")?);
        }
    }
    Some(config)
}

fn words(result: &OfflineRecognizerResult, offset: f64, end: f64) -> Vec<Word> {
    let Some(times) = result.timestamps.as_ref() else {
        return Vec::new();
    };
    if times.len() != result.tokens.len() || result.tokens.is_empty() {
        return Vec::new();
    }
    let mut words: Vec<Word> = Vec::new();
    for (token, &at) in result.tokens.iter().zip(times) {
        let at = offset + f64::from(at);
        let starts = token.starts_with(' ') || token.starts_with('▁') || words.is_empty();
        let piece = token.trim_start_matches(['▁', ' ']);
        if starts {
            if let Some(last) = words.last_mut() {
                last.end = at;
            }
            if !piece.is_empty() {
                words.push(Word {
                    text: piece.to_string(),
                    start: at,
                    end: at,
                });
            }
        } else if let Some(last) = words.last_mut() {
            last.text.push_str(piece);
        }
    }
    if let Some(last) = words.last_mut() {
        last.end = end.max(last.start);
    }
    words.retain(|word| !word.text.trim().is_empty());
    words
}
