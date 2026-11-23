use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use tauri::{AppHandle, Manager, Webview};

use super::super::speech_models;
use super::*;

fn recognize_path(state: &SpeechState, path: &Path) -> Result<Vec<voice_speech::Phrase>, String> {
    let vad = speech_models::vad_spec().ok_or_else(|| voice_speech::reason("no_model"))?;
    let recognizer = recognizer(state)?;
    voice_speech::recognize_file(&recognizer, &vad, path)
}

fn joined(phrases: &[voice_speech::Phrase]) -> String {
    phrases
        .iter()
        .map(|phrase| phrase.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

pub async fn transcribe_path(app: &AppHandle, path: PathBuf) -> Result<String, String> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || {
        let state = app.state::<SpeechState>();
        recognize_path(&state, &path).map(|phrases| joined(&phrases))
    })
    .await
    .map_err(|_| voice_speech::reason("failed"))?
}

#[tauri::command]
pub async fn speech_recognize_file(
    app: AppHandle,
    webview: Webview,
    path: String,
) -> Result<String, String> {
    require_person(&webview)?;
    transcribe_path(&app, PathBuf::from(path)).await
}

pub(crate) async fn with_recording<T: Send + 'static>(
    audio: String,
    mime: String,
    limit: usize,
    work: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    if audio.len() > limit {
        return Err("That recording is too long to recognize.".into());
    }
    let bytes = STANDARD
        .decode(audio.as_bytes())
        .map_err(|_| voice_speech::reason("file"))?;
    let extension = match mime.split(';').next().unwrap_or("").trim() {
        "audio/mp4" | "audio/x-m4a" | "audio/aac" | "video/mp4" => "m4a",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        _ => "audio",
    };
    let path =
        std::env::temp_dir().join(format!("misty-speech-{}.{extension}", uuid::Uuid::new_v4()));
    file_access::fs_async::write(&path, bytes)
        .await
        .map_err(|_| voice_speech::reason("file"))?;
    let worked_on = path.clone();
    let result = tokio::task::spawn_blocking(move || work(&worked_on))
        .await
        .map_err(|_| voice_speech::reason("failed"));
    let _ = file_access::fs::remove_file(&path);
    result?
}

#[tauri::command]
pub async fn speech_recognize_audio(
    app: AppHandle,
    webview: Webview,
    audio: String,
    mime: String,
) -> Result<String, String> {
    require_person(&webview)?;
    with_recording(audio, mime, 40 * 1024 * 1024, move |path| {
        let state = app.state::<SpeechState>();
        recognize_path(&state, path).map(|phrases| joined(&phrases))
    })
    .await
}

pub(crate) fn recognize_words(
    app: &AppHandle,
    path: &Path,
) -> Result<Vec<voice_speech::Word>, String> {
    let state = app.state::<SpeechState>();
    let phrases = recognize_path(&state, path)?;
    Ok(phrases.into_iter().flat_map(words_of).collect())
}

fn words_of(phrase: voice_speech::Phrase) -> Vec<voice_speech::Word> {
    if !phrase.words.is_empty() {
        return phrase.words;
    }
    let words: Vec<&str> = phrase.text.split_whitespace().collect();
    let letters: usize = words.iter().map(|word| word.chars().count().max(1)).sum();
    if letters == 0 {
        return Vec::new();
    }
    let span = (phrase.end - phrase.start).max(0.0);
    let mut at = phrase.start;
    words
        .into_iter()
        .map(|word| {
            let length = span * word.chars().count().max(1) as f64 / letters as f64;
            let timed = voice_speech::Word {
                text: word.to_string(),
                start: at,
                end: at + length,
            };
            at += length;
            timed
        })
        .collect()
}
