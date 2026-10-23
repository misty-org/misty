//! The local bridge Kura, the separate file manager, uses to reach this
//! device's shared clipboard (docs/design/clipboard/BRIEF.md). Kura has no
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
mod unix {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::{UnixListener, UnixStream};

    /// Where Kura finds the bridge: `<data dir>/com.misty.desktop/bridge/clipboard.sock`.
    pub fn socket_path() -> Option<PathBuf> {
        dirs::data_dir().map(|dir| {
            dir.join("com.misty.desktop")
                .join("bridge")
                .join("clipboard.sock")
        })
    }

    /// A stale socket from an earlier run is replaced; the directory is
    /// owner-only, so no other user can reach the socket.
    pub(super) fn listen(app: AppHandle, approvals: Arc<Approvals>) {
        let Some(path) = socket_path() else {
            return;
        };
        tauri::async_runtime::spawn(async move {
            let Some(directory) = path.parent() else {
                return;
            };
            if std::fs::create_dir_all(directory).is_err()
                || std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
                    .is_err()
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
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{ffi::c_void, ptr};
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree, HANDLE},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SDDL_REVISION_1,
            },
            GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY,
            TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };

    /// Where Kura finds the bridge: a pipe named for this Windows user, so
    /// each user on the machine has their own.
    pub fn pipe_name() -> Option<String> {
        user_sid().map(|sid| format!(r"\\.\pipe\com.misty.desktop.clipboard.{sid}"))
    }

    /// The SID of the user Misty runs as, as text.
    fn user_sid() -> Option<String> {
        let mut token: HANDLE = ptr::null_mut();
        // SAFETY: plain out-parameters; the token is closed below.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return None;
        }
        let mut buffer = vec![0u8; 256];
        let mut length = 0u32;
        // SAFETY: the buffer holds `len` bytes.
        let read = unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                &mut length,
            )
        } != 0;
        // SAFETY: opened above.
        unsafe { CloseHandle(token) };
        if !read {
            return None;
        }
        // SAFETY: the buffer now holds a TOKEN_USER.
        let user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
        let mut text: *mut u16 = ptr::null_mut();
        // SAFETY: a valid SID; the string is LocalAlloc'd and freed below.
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 {
            return None;
        }
        // SAFETY: a NUL-terminated string from the conversion above.
        let sid = unsafe {
            let length = (0..).take_while(|&index| *text.add(index) != 0).count();
            String::from_utf16_lossy(std::slice::from_raw_parts(text, length))
        };
        // SAFETY: allocated by the conversion above.
        unsafe { LocalFree(text.cast()) };
        Some(sid)
    }

    /// A security descriptor that admits only `sid`.
    struct OwnerOnly(PSECURITY_DESCRIPTOR);

    impl OwnerOnly {
        fn new(sid: &str) -> Option<Self> {
            let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})")
                .encode_utf16()
                .chain([0])
                .collect();
            let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
            // SAFETY: a NUL-terminated SDDL string; freed on drop.
            let made = unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    SDDL_REVISION_1,
                    &mut descriptor,
                    ptr::null_mut(),
                )
            } != 0;
            made.then_some(Self(descriptor))
        }

        fn attributes(&self) -> SECURITY_ATTRIBUTES {
            SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: self.0,
                bInheritHandle: 0,
            }
        }
    }

    impl Drop for OwnerOnly {
        fn drop(&mut self) {
            // SAFETY: allocated by the conversion in `new`.
            unsafe { LocalFree(self.0) };
        }
    }

    // SAFETY: the descriptor is immutable after creation.
    unsafe impl Send for OwnerOnly {}

    /// One pipe instance. The first refuses to open if another process
    /// already holds the name, so nothing can stand in for Misty.
    fn instance(name: &str, security: &OwnerOnly, first: bool) -> Option<NamedPipeServer> {
        let mut attributes = security.attributes();
        // SAFETY: the attributes and their descriptor outlive the call.
        unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(
                    name,
                    (&mut attributes as *mut SECURITY_ATTRIBUTES).cast::<c_void>(),
                )
        }
        .ok()
    }

    pub(super) fn listen(app: AppHandle, approvals: Arc<Approvals>) {
        let (Some(name), Some(sid)) = (pipe_name(), user_sid()) else {
            return;
        };
        let Some(security) = OwnerOnly::new(&sid) else {
            return;
        };
        tauri::async_runtime::spawn(async move {
            let Some(mut server) = instance(&name, &security, true) else {
                return;
            };
            while server.connect().await.is_ok() {
                let Some(next) = instance(&name, &security, false) else {
                    return;
                };
                let connected = std::mem::replace(&mut server, next);
                let (app, approvals) = (app.clone(), approvals.clone());
                tauri::async_runtime::spawn(async move {
                    let _ = serve(connected, app, approvals).await;
                });
            }
        });
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use tokio::net::windows::named_pipe::ClientOptions;

        #[tokio::test]
        async fn only_misty_can_hold_the_pipe_and_its_user_can_open_it() {
            let name = format!(r"\\.\pipe\misty-bridge-test-{}", uuid::Uuid::new_v4());
            let security = OwnerOnly::new(&user_sid().unwrap()).unwrap();
            let server = instance(&name, &security, true).unwrap();
            // Another process taking the name first would be refused the same way.
            assert!(instance(&name, &security, true).is_none());
            let _client = ClientOptions::new().open(&name).unwrap();
            server.connect().await.unwrap();
            assert!(pipe_name().unwrap().ends_with(&user_sid().unwrap()));
        }
    }
}

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
