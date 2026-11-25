use std::path::Path;

use voice_speech::{reason, Phrase, VadSpec, SAMPLE_RATE};

use crate::decode::decode_file;
use crate::hearing::{detector, lead_in, WINDOW};
use crate::recognizer::Recognizer;

pub fn recognize_file(
    recognizer: &Recognizer,
    vad: &VadSpec,
    path: &Path,
) -> Result<Vec<Phrase>, String> {
    let samples = decode_file(path)?;
    recognize_samples(recognizer, vad, &samples)
}

pub fn recognize_samples(
    recognizer: &Recognizer,
    vad: &VadSpec,
    samples: &[f32],
) -> Result<Vec<Phrase>, String> {
    let detector = detector(vad).ok_or_else(|| reason("model"))?;
    let mut phrases = Vec::new();
    let mut take = |detector: &sherpa_onnx::VoiceActivityDetector| {
        while let Some(segment) = detector.front() {
            let start = segment.start() as i64;
            let lead = lead_in(0, samples, start);
            let mut heard = Vec::with_capacity(lead.len() + segment.samples().len());
            heard.extend_from_slice(lead);
            heard.extend_from_slice(segment.samples());
            let offset = (start - lead.len() as i64) as f64 / SAMPLE_RATE as f64;
            let phrase = recognizer.recognize(&heard, offset);
            drop(segment);
            detector.pop();
            if !phrase.text.is_empty() {
                phrases.push(phrase);
            }
        }
    };
    for window in samples.chunks(WINDOW) {
        if window.len() == WINDOW {
            detector.accept_waveform(window);
        } else {
            let mut last = window.to_vec();
            last.resize(WINDOW, 0.0);
            detector.accept_waveform(&last);
        }
        take(&detector);
    }
    detector.flush();
    take(&detector);
    Ok(phrases)
}
