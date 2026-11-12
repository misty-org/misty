//! Tutor's video clips: each scene of a video overview filmed on this device's video model and key
//! (Settings → Models), kept as MP4 in Misty's own folder. Nothing goes to the server.
use crate::agents::run_control::{contained, ensure};

/// What a device with no video model, or no key for it, is told. Tutor reads it as "off".
const NO_VIDEO_MODEL: &str = "Choose a video model in Settings → Models to film the scenes.";

/// Where a scene's clip is kept: Misty's own folder on this computer, never synced.
fn clip_path(app: &tauri::AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    if id.is_empty() || id.len() > 100 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("That clip can't be found.".into());
    }
    let runtime = app.state::<crate::app::runtime::MistyRuntime>();
    Ok(runtime
        .environment
        .misty_dir()
        .join("tutor")
        .join("videos")
        .join(format!("{id}.mp4")))
}

fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only Misty's own windows can make videos.".into())
    }
}

/// Films one scene from the engine's shot description and keeps it.
#[tauri::command]
pub async fn tutor_video_clip_make(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
    prompt: String,
    seconds: u8,
) -> Result<(), String> {
    person_window(&webview)?;
    let path = clip_path(&app, &id)?;
    let prompt: String = prompt.chars().take(4000).collect();
    let running = ensure(&app).await?;
    let clip = contained(async move {
        let call = agent_runs::device::VideoCall { prompt: &prompt, seconds };
        running.calls.make_video(call).await
    })
    .await?
    .map_err(|error| {
        let failure = agent_runs::device::model_call_failure(&error);
        if failure.body.get("code").and_then(serde_json::Value::as_str) == Some("model_key_needed") {
            return NO_VIDEO_MODEL.to_owned();
        }
        failure
            .body
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("The video model couldn't make this clip. Check Settings → Models.")
            .to_owned()
    })?;
    if let Some(folder) = path.parent() {
        tokio::fs::create_dir_all(folder)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::write(&path, clip)
        .await
        .map_err(|error| error.to_string())
}

/// A scene's clip, as raw MP4 bytes.
#[tauri::command]
pub async fn tutor_video_clip(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    person_window(&webview)?;
    let bytes = tokio::fs::read(clip_path(&app, &id)?)
        .await
        .map_err(|_| "This scene's clip is gone. Make the video again.".to_owned())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn tutor_video_clip_delete(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let _ = tokio::fs::remove_file(clip_path(&app, &id)?).await;
    Ok(())
}
