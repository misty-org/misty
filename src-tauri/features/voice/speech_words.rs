use tauri::{AppHandle, Webview};

use super::speech::{recognize_words, require_person, with_recording};

#[tauri::command]
pub async fn speech_recognize_audio_words(
    app: AppHandle,
    webview: Webview,
    audio: String,
    mime: String,
) -> Result<Vec<voice_speech::Word>, String> {
    require_person(&webview)?;
    with_recording(audio, mime, 200 * 1024 * 1024, move |path| {
        recognize_words(&app, path)
    })
    .await
}
