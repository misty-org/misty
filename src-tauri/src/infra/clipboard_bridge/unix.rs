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
