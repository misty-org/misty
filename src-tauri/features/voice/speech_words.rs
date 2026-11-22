//! Recognizing a recording word by word, each word with its time, for captions.

use tauri::{AppHandle, Webview};

use super::speech::{recognize_words, require_person, with_recording};

/// Recognizes a recording held by the window word by word, each word with its time in seconds
/// from the start. Sent as base64 with its type, like `speech_recognize_audio`, written to a
/// temporary file for the recognizer and removed after.
#[tauri::command]
pub async fn speech_recognize_audio_words(
    app: AppHandle,
    webview: Webview,
    audio: String,
    mime: String,
) -> Result<Vec<voice_speech::Word>, String> {
    require_person(&webview)?;
    // A video's soundtrack at 16 kHz mono is about 2 MB a minute; this is over an hour.
    with_recording(audio, mime, 200 * 1024 * 1024, move |path| recognize_words(&app, path)).await
}
