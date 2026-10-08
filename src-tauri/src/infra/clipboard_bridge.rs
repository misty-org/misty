//! The local bridge Kura, the separate file manager, uses to reach this
//! device's shared clipboard (docs/design/clipboard/BRIEF.md). Kura has no
//! account; Misty answers only on a user-only socket and only after the
//! person allows Kura once. Nothing but clips this device could already
//! paste crosses the bridge.
#![cfg(all(desktop, unix))]

use std::{
    collections::HashSet,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
};

use crate::app::runtime::MistyRuntime;

const MAX_LINE: usize = 64 * 1024;

/// Where Kura finds the bridge: `<data dir>/com.misty.desktop/bridge/clipboard.sock`.
pub fn socket_path() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| {
        dir.join("com.misty.desktop")
            .join("bridge")
            .join("clipboard.sock")
    })
}

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

/// Approved Kura installs, by the SHA-256 of their token. Stored beside the
/// app's other settings with owner-only permissions.
struct Approvals {
    path: PathBuf,
    hashes: Mutex<HashSet<String>>,
    /// One consent prompt at a time.
    asking: tokio::sync::Mutex<()>,
}

impl Approvals {
    fn load(path: PathBuf) -> Self {
        let hashes = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok())
            .unwrap_or_default()
            .into_iter()
            .collect();
        Self {
            path,
            hashes: Mutex::new(hashes),
            asking: tokio::sync::Mutex::new(()),
        }
    }

    fn allows(&self, token: &str) -> bool {
        !token.is_empty()
            && self
                .hashes
                .lock()
                .is_ok_and(|hashes| hashes.contains(&hash(token)))
    }

    fn approve(&self) -> std::io::Result<String> {
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        let token = hex::encode(bytes);
        let mut hashes = self
            .hashes
            .lock()
            .map_err(|_| std::io::Error::other("approvals"))?;
        hashes.insert(hash(&token));
        let list: Vec<&String> = hashes.iter().collect();
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.path, serde_json::to_vec(&list)?)?;
        std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600))?;
        Ok(token)
    }
}

fn hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Starts listening. A stale socket from an earlier run is replaced; the
/// directory is owner-only, so no other user can reach the socket.
pub fn start(app: AppHandle, config_dir: PathBuf) {
    let Some(path) = socket_path() else {
        return;
    };
    let approvals = Arc::new(Approvals::load(config_dir.join("kura-bridge.json")));
    tauri::async_runtime::spawn(async move {
        let Some(directory) = path.parent() else {
            return;
        };
        if std::fs::create_dir_all(directory).is_err()
            || std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700)).is_err()
        {
            return;
        }
        let _ = std::fs::remove_file(&path);
        let Ok(listener) = UnixListener::bind(&path) else {
            return;
        };
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        while let Ok((stream, _)) = listener.accept().await {
            if !same_user(&stream) {
                continue;
            }
            let (app, approvals) = (app.clone(), approvals.clone());
            tauri::async_runtime::spawn(async move {
                let _ = serve(stream, app, approvals).await;
            });
        }
    });
}

fn same_user(stream: &UnixStream) -> bool {
    stream
        .peer_cred()
        .is_ok_and(|cred| cred.uid() == unsafe { libc::geteuid() })
}

async fn serve(
    stream: UnixStream,
    app: AppHandle,
    approvals: Arc<Approvals>,
) -> std::io::Result<()> {
    let (reader, mut writer) = stream.into_split();
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
