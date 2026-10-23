//! The local bridge Kura, the separate file manager, uses to reach this
//! device's shared clipboard (docs/sync/clipboard.md). Kura has no
//! account; Misty answers only on a user-only channel and only after the
//! person allows Kura once. Nothing but clips this device could already
//! paste crosses the bridge. The channel is a Unix socket in an owner-only
//! folder, or on Windows a named pipe only this user can open.
#![cfg(all(desktop, any(unix, windows)))]

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use super::store::Store;
use crate::app::runtime::MistyRuntime;
mod approvals;
use approvals::Approvals;

const MAX_LINE: usize = 64 * 1024;

#[derive(Debug, Deserialize)]
struct Request {
    id: u64,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    id: u64,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Starts listening on this platform's user-only channel.
pub fn start(app: AppHandle, store: Store, config_dir: PathBuf) {
    let approvals = Arc::new(Approvals::load(store, config_dir.join("kura-bridge.json")));
    #[cfg(unix)]
    unix::listen(app, approvals);
    #[cfg(windows)]
    windows::listen(app, approvals);
}

#[cfg(unix)]
mod unix;

#[cfg(windows)]
mod windows;

async fn serve(
    stream: impl AsyncRead + AsyncWrite,
    app: AppHandle,
    approvals: Arc<Approvals>,
) -> std::io::Result<()> {
    let (reader, mut writer) = tokio::io::split(stream);
    let mut lines = BufReader::new(reader).lines();
    let mut approved = false;
    let mut changes: Option<tokio::sync::broadcast::Receiver<()>> = None;
    loop {
        let line = if let Some(receiver) = changes.as_mut() {
            tokio::select! {
                line = lines.next_line() => line?,
                changed = receiver.recv() => {
                    if !matches!(changed, Err(tokio::sync::broadcast::error::RecvError::Closed)) {
                        writer.write_all(b"{\"event\":\"changed\"}\n").await?;
                    }
                    continue;
                }
            }
        } else {
            lines.next_line().await?
        };
        let Some(line) = line else {
            return Ok(());
        };
        if line.len() > MAX_LINE {
            return Ok(());
        }
        let Ok(request) = serde_json::from_str::<Request>(&line) else {
            return Ok(());
        };
        let outcome = if request.method == "hello" {
            hello(&app, &approvals, &request.params)
                .await
                .map(|(result, ok)| {
                    approved = ok;
                    result
                })
        } else if !approved {
            Err("Allow Kura in Misty first.".to_owned())
        } else if request.method == "subscribe" {
            changes = Some(runtime(&app).cloud_clipboard.subscribe());
            Ok(json!({}))
        } else {
            call(&app, &request.method, &request.params).await
        };
        let response = match outcome {
            Ok(result) => Response {
                id: request.id,
                ok: true,
                result: Some(result),
                error: None,
            },
            Err(error) => Response {
                id: request.id,
                ok: false,
                result: None,
                error: Some(error),
            },
        };
        let mut bytes = serde_json::to_vec(&response).map_err(std::io::Error::other)?;
        bytes.push(b'\n');
        writer.write_all(&bytes).await?;
    }
}

fn runtime(app: &AppHandle) -> tauri::State<'_, MistyRuntime> {
    app.state::<MistyRuntime>()
}

async fn hello(
    app: &AppHandle,
    approvals: &Approvals,
    params: &Value,
) -> Result<(Value, bool), String> {
    let token = params["token"].as_str().unwrap_or_default();
    if approvals.allows(token) {
        return Ok((json!({ "status": "approved" }), true));
    }
    let _asking = approvals.asking.lock().await;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message("Kura wants to show the clipboard you share across your Misty devices, and paste clips into folders you choose. Kura can't read anything else in Misty.")
        .title("Allow Kura to use your Misty clipboard?")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom("Allow".into(), "Don’t Allow".into()))
        .show(move |allowed| {
            let _ = sender.send(allowed);
        });
    if !receiver.await.unwrap_or(false) {
        return Ok((json!({ "status": "denied" }), false));
    }
    let token = approvals.approve().map_err(|error| error.to_string())?;
    Ok((json!({ "status": "approved", "token": token }), true))
}

async fn call(app: &AppHandle, method: &str, params: &Value) -> Result<Value, String> {
    let state = runtime(app);
    match method {
        "list" => {
            serde_json::to_value(state.cloud_clipboard.view()).map_err(|error| error.to_string())
        }
        "copy" => {
            let clip_id = params["clipId"].as_str().ok_or("Choose a clip.")?;
            let payload = state.cloud_clipboard.open_clip(clip_id).await?;
            let clipboard = state.clipboard.clone();
            let written =
                tokio::task::spawn_blocking(move || clipboard.apply_payload_to_system(payload))
                    .await
                    .map_err(|error| error.to_string())?;
            if written {
                Ok(json!({}))
            } else {
                Err("This clip couldn't be copied.".into())
            }
        }
        "materialize" => {
            let clip_id = params["clipId"].as_str().ok_or("Choose a clip.")?;
            let directory = PathBuf::from(params["directory"].as_str().ok_or("Choose a folder.")?);
            if !directory.is_absolute() || !directory.is_dir() {
                return Err("Choose an existing folder.".into());
            }
            let saved = state
                .cloud_clipboard
                .save_clip_files(clip_id, &directory)
                .await;
            match saved {
                Ok(paths) => Ok(json!({ "paths": paths })),
                // A text clip becomes a text file, like pasting text into a folder.
                Err(_) => paste_text(&state, clip_id, &directory).await,
            }
        }
        _ => Err("Unknown request.".into()),
    }
}

async fn paste_text(
    state: &MistyRuntime,
    clip_id: &str,
    directory: &Path,
) -> Result<Value, String> {
    let payload = state.cloud_clipboard.open_clip(clip_id).await?;
    if payload.text.is_empty() {
        return Err("This clip has nothing to paste.".into());
    }
    let mut target = directory.join("Clipboard.txt");
    let mut index = 2;
    while target.exists() {
        target = directory.join(format!("Clipboard {index}.txt"));
        index += 1;
    }
    std::fs::write(&target, payload.text.as_bytes()).map_err(|error| error.to_string())?;
    Ok(json!({ "paths": [target] }))
}
