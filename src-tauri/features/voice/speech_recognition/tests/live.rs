use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::time::Duration;

use voice_speech::{
    decode_file, recognize_file, use_helper, Hearing, HearingEvent, HearingFamily, HearingSpec,
    Recognizer, VadSpec,
};

fn helper() -> Result<std::process::Command, String> {
    let program = std::env::var("MISTY_SPEECH_HELPER").map_err(|_| "set MISTY_SPEECH_HELPER")?;
    Ok(std::process::Command::new(program))
}

fn models() -> PathBuf {
    use_helper(helper);
    PathBuf::from(std::env::var("MISTY_SPEECH_MODELS").expect("set MISTY_SPEECH_MODELS"))
}

fn parakeet() -> HearingSpec {
    let files: HashMap<String, String> = [
        ("encoder", "encoder.int8.onnx"),
        ("decoder", "decoder.int8.onnx"),
        ("joiner", "joiner.int8.onnx"),
        ("tokens", "tokens.txt"),
    ]
    .into_iter()
    .map(|(role, name)| (role.to_string(), name.to_string()))
    .collect();
    HearingSpec {
        family: HearingFamily::NemoTransducer,
        dir: models().join("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"),
        files,
    }
}

fn vad() -> VadSpec {
    VadSpec {
        model: models().join("silero_vad.onnx"),
    }
}

fn english_recording() -> PathBuf {
    models().join("sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/test_wavs/en.wav")
}

#[test]
#[ignore = "needs the real models; see the top of this file"]
fn hears_a_recording_phrase_by_phrase_with_word_times() {
    let recognizer = Recognizer::open(&parakeet(), None).expect("Parakeet opens");
    let phrases = recognize_file(&recognizer, &vad(), &english_recording()).expect("recognized");
    let text: Vec<&str> = phrases.iter().map(|phrase| phrase.text.as_str()).collect();
    println!("heard: {text:?}");
    assert!(!phrases.is_empty(), "no speech found");
    assert!(phrases.iter().all(|phrase| phrase.end > phrase.start));
    assert!(
        phrases.iter().any(|phrase| !phrase.words.is_empty()),
        "Parakeet times its words"
    );
}

#[test]
#[ignore = "needs the real models; see the top of this file"]
fn hears_live_audio_and_tells_what_was_said_once_closed() {
    let recognizer = Arc::new(Recognizer::open(&parakeet(), None).expect("Parakeet opens"));
    let (told, events) = channel();
    let hearing = Hearing::open(recognizer, vad(), move |event| {
        let _ = told.send(event);
    });
    let samples = decode_file(&english_recording()).expect("decoded");
    for chunk in samples.chunks(1_600) {
        hearing.push("mic", chunk).expect("fed");
    }
    hearing.close();
    let mut started = false;
    let mut heard = String::new();
    loop {
        match events
            .recv_timeout(Duration::from_secs(60))
            .expect("closed in time")
        {
            HearingEvent::Started { input } => {
                assert_eq!(input, "mic");
                started = true;
            }
            HearingEvent::Heard { phrase, .. } => heard.push_str(&phrase.text),
            HearingEvent::Stopped { .. } => {}
            HearingEvent::Closed => break,
        }
    }
    println!("heard live: {heard}");
    assert!(started, "speech start was never told");
    assert!(!heard.trim().is_empty(), "nothing was heard");
}
