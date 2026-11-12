//! A small picture of the page an agent's run is working on, for its steps in the person's activity
//! view. It is taken without showing the page or touching the agent's grants, and stays on this
//! computer.
use base64::Engine;
use tauri::{AppHandle, Manager};

use crate::browser::BrowserSessionState;

const PAGE_PREFIX: &str = "misty-browser-";

/// The page of one of these runs, as JPEG bytes at most 640 pixels on its long side.
pub(crate) async fn picture_of_run(app: &AppHandle, run_ids: &[String]) -> Option<Vec<u8>> {
    let id = {
        let state = app.try_state::<BrowserSessionState>()?;
        let sessions = state.sessions.lock().ok()?;
        sessions
            .iter()
            .find(|(_, session)| {
                session
                    .agent_run_id
                    .as_ref()
                    .is_some_and(|run| run_ids.contains(run))
            })
            .map(|(id, _)| id.clone())?
    };
    let view = app.get_webview(&format!("{PAGE_PREFIX}{id}"))?;
    let data_url = capture(view).await.ok()?;
    let (head, body) = data_url.split_once(',')?;
    if !head.starts_with("data:image/") {
        return None;
    }
    base64::engine::general_purpose::STANDARD.decode(body).ok()
}

#[cfg(target_os = "macos")]
async fn capture(view: tauri::Webview) -> Result<String, String> {
    let scale = view.window().scale_factor().map_err(|e| e.to_string())?;
    let size = view
        .size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(scale);
    let picture = crate::browser::pages::macos::capture_webview_region(
        view,
        0.0,
        0.0,
        size.width,
        size.height,
    )
    .await?;
    picture["dataUrl"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "The capture had no picture.".into())
}

#[cfg(not(target_os = "macos"))]
async fn capture(_view: tauri::Webview) -> Result<String, String> {
    Err("Step pictures are taken on macOS.".into())
}
