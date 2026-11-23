use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribedSource {
    name: String,
    mime_type: String,
    text: String,
    error: Option<String>,
}

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
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        _ => return None,
    })
}

#[tauri::command]
pub async fn tutor_transcribe_sources(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    language: Option<String>,
) -> Result<Vec<TranscribedSource>, String> {
    use tauri_plugin_dialog::DialogExt;
    let _ = language;
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
                "mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "mp4", "m4v", "mov",
            ],
        )
        .pick_files(move |files| {
            let _ = send.send(files);
        });
    let Some(files) = receive.await.ok().flatten() else {
        return Ok(Vec::new());
    };
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
        file_access::allow_picked_file(&path, file_access::Access::Read);
        let size = file_access::fs::metadata(&path)
            .map(|meta| meta.len())
            .unwrap_or(u64::MAX);
        if size > MAX_MEDIA_BYTES {
            sources.push(failed(
                "It's longer than Misty can transcribe at once (28 MB).".into(),
            ));
            continue;
        }
        let heard = crate::voice::speech::transcribe_path(&app, path.clone()).await;
        sources.push(match heard {
            Ok(text) => TranscribedSource {
                name,
                mime_type: mime_type.to_owned(),
                text,
                error: None,
            },
            Err(error) => failed(error),
        });
    }
    Ok(sources)
}

#[derive(serde::Deserialize)]
pub struct OverviewLine {
    speaker: u8,
    text: String,
}

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

#[tauri::command]
pub async fn tutor_overview_make(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
    lines: Vec<OverviewLine>,
    voice: Option<String>,
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
    let audio = super::system_speech::speak_dialogue(&app, &lines, voice.as_deref()).await?;
    if let Some(folder) = path.parent() {
        file_access::fs_async::create_dir_all(folder)
            .await
            .map_err(|error| error.to_string())?;
    }
    let seconds = audio.len().saturating_sub(44) as f64 / (24_000.0 * 2.0);
    file_access::fs_async::write(&path, audio)
        .await
        .map_err(|error| error.to_string())?;
    Ok(seconds)
}

#[tauri::command]
pub async fn tutor_overview_audio(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only Misty's own windows can play overviews.".into());
    }
    let bytes = file_access::fs_async::read(overview_path(&app, &id)?)
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
    let _ = file_access::fs_async::remove_file(overview_path(&app, &id)?).await;
    Ok(())
}

#[cfg(test)]
#[path = "calls_tests.rs"]
mod tests;
