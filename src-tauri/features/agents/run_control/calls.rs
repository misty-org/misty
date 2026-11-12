//! This computer's model calls outside runs, on the crate. The renderer sees the codes and statuses
//! in `DeviceCallFailure`.
use agent_runs::device::DEVICE_CALL_NAMES;
use serde::Serialize;
use serde_json::Value;

/// What a device call answered: its status and body, so the renderer can tell a missing key
/// from a provider failure.
#[derive(Serialize)]
pub struct CallReply {
    pub(super) status: u16,
    pub(super) body: Value,
}

/// One model call on this computer's runtime, with this device's models and keys. The body is the
/// renderer's JSON as text, because a run's schema goes to the model in its own key order, and a
/// parsed `Value` would sort it.
#[tauri::command]
pub async fn agent_runtime_call(
    app: tauri::AppHandle,
    name: String,
    body: String,
) -> Result<CallReply, String> {
    if !DEVICE_CALL_NAMES.contains(&name.as_str()) {
        return Err("Misty doesn't know this model call.".into());
    }
    let running = super::ensure(&app).await?;
    let answered = super::contained(async move { running.calls.device_call(&name, &body).await });
    Ok(match answered.await? {
        Ok(body) => CallReply { status: 200, body },
        Err(failure) => CallReply {
            status: failure.status,
            body: failure.body,
        },
    })
}

/// One recording a Tutor notebook took as a source: who said what, as text.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribedSource {
    name: String,
    mime_type: String,
    text: String,
    /// Why it couldn't be read, when it couldn't.
    error: Option<String>,
}

/// Soniox reads a file of at most this many bytes in one call; the body carries it as base64.
const MAX_MEDIA_BYTES: u64 = 28 << 20;

fn media_type(path: &std::path::Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "webm" => "video/webm",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        _ => return None,
    })
}

/// "Who: words" lines from the diarized call's turns, or its plain text when it found no speakers.
fn transcript_text(body: &Value) -> String {
    let turns = body.get("turns").and_then(Value::as_array);
    match turns.filter(|turns| turns.len() > 1) {
        Some(turns) => turns
            .iter()
            .filter_map(|turn| {
                let text = turn.get("text")?.as_str()?.trim();
                let speaker = turn.get("speaker").and_then(Value::as_str).unwrap_or("?");
                (!text.is_empty()).then(|| format!("Speaker {speaker}: {text}"))
            })
            .collect::<Vec<_>>()
            .join("\n"),
        None => body
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_owned(),
    }
}

/// Tutor's audio and video sources: the person picks recordings in the system dialog, and each is
/// transcribed with speakers on this device's Soniox key. The window never names a path.
#[tauri::command]
pub async fn tutor_transcribe_sources(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Vec<TranscribedSource>, String> {
    use base64::Engine;
    use tauri_plugin_dialog::DialogExt;
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can add sources.".into());
    }
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Add recordings")
        .add_filter(
            "Audio and video",
            &[
                "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "webm", "mp4", "m4v",
                "mov",
            ],
        )
        .pick_files(move |files| {
            let _ = send.send(files);
        });
    let Some(files) = receive.await.ok().flatten() else {
        return Ok(Vec::new());
    };
    let running = super::ensure(&app).await?;
    let mut sources = Vec::new();
    for file in files.into_iter().take(10) {
        let Ok(path) = file.into_path() else { continue };
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Recording")
            .to_owned();
        let Some(mime_type) = media_type(&path) else {
            continue;
        };
        let failed = |error: String| TranscribedSource {
            name: name.clone(),
            mime_type: mime_type.to_owned(),
            text: String::new(),
            error: Some(error),
        };
        let size = std::fs::metadata(&path)
            .map(|meta| meta.len())
            .unwrap_or(u64::MAX);
        if size > MAX_MEDIA_BYTES {
            sources.push(failed(
                "It's longer than Misty can transcribe at once (28 MB).".into(),
            ));
            continue;
        }
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(_) => {
                sources.push(failed("It couldn't be read.".into()));
                continue;
            }
        };
        let body = serde_json::json!({
            "mediaType": mime_type,
            "audio": base64::engine::general_purpose::STANDARD.encode(bytes),
        })
        .to_string();
        let calls = running.clone();
        let answered =
            super::contained(
                async move { calls.calls.device_call("transcribe-diarized", &body).await },
            )
            .await?;
        sources.push(match answered {
            Ok(body) => TranscribedSource {
                name,
                mime_type: mime_type.to_owned(),
                text: transcript_text(&body),
                error: None,
            },
            Err(failure) => failed(
                failure
                    .body
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Soniox couldn't transcribe it. Check the key in Settings → Models.")
                    .to_owned(),
            ),
        });
    }
    Ok(sources)
}

/// One line of an audio overview's script.
#[derive(serde::Deserialize)]
pub struct OverviewLine {
    speaker: u8,
    text: String,
}

/// Where an overview's audio is kept: Misty's own folder on this computer, never synced.
fn overview_path(app: &tauri::AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    if id.is_empty() || id.len() > 100 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("That overview can't be found.".into());
    }
    let runtime = app.state::<crate::app::runtime::MistyRuntime>();
    Ok(runtime
        .environment
        .misty_dir()
        .join("tutor")
        .join("overviews")
        .join(format!("{id}.wav")))
}

/// Speaks an audio overview's script on this device's speech model and key, and keeps the audio.
/// Answers how many seconds it runs.
#[tauri::command]
pub async fn tutor_overview_make(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
    lines: Vec<OverviewLine>,
) -> Result<f64, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can make overviews.".into());
    }
    let path = overview_path(&app, &id)?;
    let lines: Vec<(u8, String)> = lines
        .into_iter()
        .take(120)
        .map(|line| (line.speaker.min(1), line.text.chars().take(3000).collect()))
        .collect();
    let running = super::ensure(&app).await?;
    let audio = super::contained(async move { running.calls.speak_dialogue(&lines).await })
        .await?
        .map_err(|error| {
            let failure = agent_runs::device::model_call_failure(&error);
            failure
                .body
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("The speech model couldn't read it. Check Settings → Models.")
                .to_owned()
        })?;
    if let Some(folder) = path.parent() {
        tokio::fs::create_dir_all(folder)
            .await
            .map_err(|error| error.to_string())?;
    }
    let seconds = audio.len().saturating_sub(44) as f64 / (24_000.0 * 2.0);
    tokio::fs::write(&path, audio)
        .await
        .map_err(|error| error.to_string())?;
    Ok(seconds)
}

/// An overview's audio, as raw WAV bytes.
#[tauri::command]
pub async fn tutor_overview_audio(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can play overviews.".into());
    }
    let bytes = tokio::fs::read(overview_path(&app, &id)?)
        .await
        .map_err(|_| "This overview's audio is gone. Make it again.".to_owned())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn tutor_overview_delete(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can delete overviews.".into());
    }
    let _ = tokio::fs::remove_file(overview_path(&app, &id)?).await;
    Ok(())
}

#[cfg(test)]
#[path = "calls_tests.rs"]
mod tests;
