//! Recognizing a recording word by word, each word with its time, for the video editor's captions.

use tauri::Webview;

use super::speech::require_person;

/// Recognizes a recording held by the window word by word, each word with its time in seconds
/// from the start, for the video editor's captions. Sent as base64 with its type, like
/// `speech_recognize_audio`, written to a temporary file for the recognizer and removed after.
#[tauri::command]
pub async fn speech_recognize_audio_words(
    webview: Webview,
    audio: String,
    mime: String,
    language: Option<String>,
) -> Result<Vec<voice_speech::Phrase>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    require_person(&webview)?;
    // A video's soundtrack at 16 kHz mono is about 2 MB a minute; this is over an hour.
    if audio.len() > 200 * 1024 * 1024 {
        return Err("That recording is too long to recognize.".into());
    }
    let bytes = STANDARD
        .decode(audio.as_bytes())
        .map_err(|_| voice_speech::reason("failed"))?;
    let extension = match mime.split(';').next().unwrap_or("").trim() {
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/mpeg" => "mp3",
        _ => "wav",
    };
    let path =
        std::env::temp_dir().join(format!("misty-speech-{}.{extension}", uuid::Uuid::new_v4()));
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|_| voice_speech::reason("failed"))?;
    let file = path.to_string_lossy().into_owned();
    let heard = tokio::task::spawn_blocking(move || {
        voice_speech::recognize_file_phrases(&file, language.as_deref())
    })
    .await
    .map_err(|_| voice_speech::reason("failed"));
    let _ = tokio::fs::remove_file(&path).await;
    heard?
}
