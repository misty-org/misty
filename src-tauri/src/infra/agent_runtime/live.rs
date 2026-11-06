//! The commands behind voice and live transcription. Each one's messages are what its WebSocket
//! carried (`src/api/runtimeSocket.ts`, `sessions.rs`). There are no tickets: a page can't call these,
//! and only a person's own window can open a session, never an incognito one.
use std::sync::Arc;

use misty_agent::runtime::{
    live::{open_soniox, run_live_session, LiveSessionSpec},
    voice::{run_voice_session, DeviceVoiceModels},
};
use tauri::ipc::{Channel, InvokeBody, Request};

use super::sessions::{self, Frames, SessionMessage};
use crate::infra::profile_windows;

const NOT_THIS_WINDOW: &str = "Voice works only in your own Misty windows.";
/// A live session refused for its key reached the renderer as a socket that didn't connect, so it has
/// this one sentence whatever the reason.
const LIVE_REFUSED: &str = "Live transcription couldn't connect.";

fn own_window(webview: &tauri::Webview) -> Result<&str, String> {
    let label = webview.label();
    if profile_windows::is_person_window(label) {
        Ok(label)
    } else {
        Err(NOT_THIS_WINDOW.to_owned())
    }
}

#[cfg(debug_assertions)]
fn on_the_rust_runtime() -> Result<(), String> {
    if super::typescript_baseline::selected() {
        return Err("Voice isn't available while benchmarking the TypeScript runtime.".to_owned());
    }
    Ok(())
}

#[cfg(not(debug_assertions))]
fn on_the_rust_runtime() -> Result<(), String> {
    Ok(())
}

/// The companion's spoken conversation.
#[tauri::command]
pub async fn agent_runtime_voice_open(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    on_message: Channel<SessionMessage>,
) -> Result<String, String> {
    let owner = own_window(&webview)?;
    on_the_rust_runtime()?;
    let running = super::ensure(&app).await?;
    let models = Arc::new(DeviceVoiceModels::new(
        running.runtime.device_models(),
        running.client.clone(),
    ));
    let (frames, incoming) = Frames::text();
    Ok(sessions::open(owner, on_message, frames, move |outgoing| {
        Box::pin(run_voice_session(models, incoming, outgoing))
    }))
}

/// One live transcription session, on this device's Soniox key.
#[tauri::command]
pub async fn agent_runtime_live_open(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    channels: Vec<String>,
    language: String,
    on_message: Channel<SessionMessage>,
) -> Result<String, String> {
    let owner = own_window(&webview)?;
    on_the_rust_runtime()?;
    let spec = LiveSessionSpec::for_device(&channels, &language)?;
    let running = super::ensure(&app).await?;
    let models = running.runtime.device_models();
    let factory = open_soniox(models.as_ref(), &spec, &running.client)
        .map_err(|_| LIVE_REFUSED.to_owned())?;
    let (frames, incoming) = Frames::binary();
    Ok(sessions::open(owner, on_message, frames, move |outgoing| {
        Box::pin(run_live_session(
            spec,
            Arc::new(factory),
            incoming,
            outgoing,
        ))
    }))
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Missing session details.".to_owned())
}

/// One message to a session, as its raw bytes. Numbered, because IPC calls don't promise to arrive in
/// the order they were made.
#[tauri::command]
pub async fn agent_runtime_session_send(
    webview: tauri::Webview,
    request: Request<'_>,
) -> Result<(), String> {
    let owner = own_window(&webview)?;
    let id = header(&request, "x-misty-session")?;
    let number = header(&request, "x-misty-number")?
        .parse::<u64>()
        .map_err(|_| "Missing session details.")?;
    let InvokeBody::Raw(frame) = request.body() else {
        return Err("Expected a binary message.".to_owned());
    };
    sessions::deliver(owner, id, number, frame.clone()).await
}

/// Closes the renderer's side of a session. The channel says when it has ended.
#[tauri::command]
pub async fn agent_runtime_session_close(
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    let owner = own_window(&webview)?;
    sessions::close(owner, &id).await
}
