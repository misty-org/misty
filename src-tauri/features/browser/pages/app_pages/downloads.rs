use std::path::{Path, PathBuf};

use file_access::fs;
use serde_json::json;
use tauri::{webview::DownloadEvent, AppHandle};

use crate::apps::{frames, scheme::mime_of};
use crate::browser::history_downloads::download_names::sanitize_download_name;

const MAX_DOWNLOAD_BYTES: u64 = 256 << 20;

fn folder(mount: &str) -> Option<PathBuf> {
    let home = file_access::paths::misty_home_dir()?;
    Some(
        home.join("app-downloads")
            .join(mount)
            .join(uuid::Uuid::new_v4().simple().to_string()),
    )
}

fn deliver(app: &AppHandle, mount: &str, path: &Path) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or("The download has no name.")?;
    let size = fs::metadata(path).map_err(|error| error.to_string())?.len();
    if size > MAX_DOWNLOAD_BYTES {
        return Err(format!("{name} is too big to save to Files from here."));
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let reference = uuid::Uuid::new_v4().simple().to_string();
    frames::put_bytes(mount, None, &reference, bytes)?;
    frames::emit_page(
        app,
        mount,
        "download",
        Some(json!({ "reference": reference, "name": name, "mime": mime_of(&name) }).to_string()),
    );
    Ok(())
}

pub(super) fn handle(app: &AppHandle, mount: &str, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { destination, .. } => {
            let suggested = destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("download")
                .to_owned();
            let Some(folder) = folder(mount) else {
                return false;
            };
            if fs::create_dir_all(&folder).is_err() {
                return false;
            }
            *destination = folder.join(sanitize_download_name(&suggested));
            true
        }
        DownloadEvent::Finished { path, success, .. } => {
            let Some(path) = path else {
                return true;
            };
            if success {
                if let Err(error) = deliver(app, mount, &path) {
                    frames::emit_page(
                        app,
                        mount,
                        "download-failed",
                        Some(json!({ "message": error }).to_string()),
                    );
                }
            } else {
                frames::emit_page(
                    app,
                    mount,
                    "download-failed",
                    Some(json!({ "message": "The download didn't finish." }).to_string()),
                );
            }
            if let Some(parent) = path.parent() {
                let _ = fs::remove_dir_all(parent);
            }
            true
        }
        _ => true,
    }
}
