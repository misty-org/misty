//! Download events and destinations for browser pages, and each tab's own list of them.

use crate::browser::*;
use file_access::{self, fs};

#[cfg(target_os = "macos")]
pub(crate) mod macos;
mod settings;
use settings::browser_download_directory;

pub(in crate::browser) fn handle_download_event(
    app: &AppHandle,
    tab_id: &str,
    event: DownloadEvent<'_>,
) -> bool {
    let Some(state) = app.try_state::<BrowserSessionState>() else {
        return false;
    };
    match event {
        DownloadEvent::Requested { url, destination } => {
            let agent_download = state
                .sessions
                .lock()
                .ok()
                .and_then(|sessions| {
                    sessions
                        .get(tab_id)
                        .and_then(|session| session.pending_agent_download.as_ref())
                        .map(|pending| pending.expires_at > Utc::now())
                })
                .unwrap_or(false);
            let Some(download_dir) = browser_download_directory(app, agent_download) else {
                emit_download_failure(
                    app,
                    &state,
                    tab_id,
                    &url,
                    "The download destination is unavailable.",
                );
                return false;
            };
            // The Downloads folder asks the first time. WebKit and WebView2 ask for a
            // destination on the main thread and expect an answer before returning, so the
            // wait happens here, in place.
            if !agent_download && !permissions::ensure_downloads_folder(app) {
                emit_download_failure(app, &state, tab_id, &url, DOWNLOADS_NOT_ALLOWED);
                return false;
            }
            if let Err(error) = fs::create_dir_all(&download_dir) {
                emit_download_failure(app, &state, tab_id, &url, &error.to_string());
                return false;
            }
            let suggested = destination
                .file_name()
                .and_then(|value| value.to_str())
                .or_else(|| {
                    url.path_segments()
                        .and_then(|mut values| values.next_back())
                })
                .unwrap_or("download");
            let path =
                reserve_download_path(&state, &download_dir, &sanitize_download_name(suggested));
            // Finishing this one mustn't depend on the folder's grant staying as it is now.
            file_access::allow_recorded_download(&path);
            *destination = path.clone();
            let record = requested_download(&state, tab_id, &url, &path);
            let _ = app.emit_to(
                browser_owner_label(app, tab_id),
                "misty://browser-download",
                record,
            );
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let record = finish_download(&state, tab_id, &url, path.as_deref(), success);
            // This file, for this session: an agent's download is uploaded to its Space through
            // `asset:`, which covers nothing else until the person picks or drops something.
            if record.success {
                let _ = app.asset_protocol_scope().allow_file(&record.path);
            }
            let _ = app.emit_to(
                browser_owner_label(app, tab_id),
                "misty://browser-download",
                record,
            );
            true
        }
        _ => true,
    }
}

const DOWNLOADS_NOT_ALLOWED: &str =
    "Misty needs your OK to save to the Downloads folder. Start the download again to allow it.";

pub(in crate::browser) fn emit_download_failure(
    app: &AppHandle,
    state: &BrowserSessionState,
    tab_id: &str,
    url: &Url,
    error: &str,
) {
    let record = BrowserDownload {
        download_id: format!("download-{}", uuid::Uuid::new_v4()),
        tab_id: tab_id.to_owned(),
        url: url.to_string(),
        path: String::new(),
        state: "failed".to_owned(),
        success: false,
        initiator: "human".to_owned(),
        agent_id: None,
        grant_id: None,
        task_id: None,
        file: None,
        error: Some(error.to_owned()),
    };
    if let Ok(mut sessions) = state.sessions.lock() {
        let downloads = &mut sessions.entry(tab_id.to_owned()).or_default().downloads;
        downloads.push(record.clone());
        if downloads.len() > MAX_DOWNLOAD_HISTORY {
            downloads.remove(0);
        }
    }
    let _ = app.emit_to(
        browser_owner_label(app, tab_id),
        "misty://browser-download",
        record,
    );
}

pub(in crate::browser) fn requested_download(
    state: &BrowserSessionState,
    tab_id: &str,
    url: &Url,
    path: &Path,
) -> BrowserDownload {
    let mut sessions = state
        .sessions
        .lock()
        .expect("browser session mutex poisoned");
    let session = sessions.entry(tab_id.to_owned()).or_default();
    let pending = session
        .pending_agent_download
        .take()
        .filter(|pending| pending.expires_at > Utc::now());
    let record = BrowserDownload {
        download_id: format!("download-{}", uuid::Uuid::new_v4()),
        tab_id: tab_id.to_owned(),
        url: url.to_string(),
        path: path.to_string_lossy().into_owned(),
        state: "requested".to_owned(),
        success: false,
        initiator: if pending.is_some() { "agent" } else { "human" }.to_owned(),
        agent_id: pending.as_ref().map(|value| value.agent_id.clone()),
        grant_id: pending.as_ref().map(|value| value.grant_id.clone()),
        task_id: pending.as_ref().and_then(|value| value.task_id.clone()),
        file: None,
        error: None,
    };
    session.downloads.push(record.clone());
    if session.downloads.len() > MAX_DOWNLOAD_HISTORY {
        session.downloads.remove(0);
    }
    record
}

pub(in crate::browser) fn finish_download(
    state: &BrowserSessionState,
    tab_id: &str,
    url: &Url,
    path: Option<&Path>,
    success: bool,
) -> BrowserDownload {
    // Wry's macOS WKDownload delegate returns no path even on success.
    // Recover only our uniquely recorded destination, never guess a filename.
    let pending = {
        let sessions = state
            .sessions
            .lock()
            .expect("browser session mutex poisoned");
        let matches = sessions
            .get(tab_id)
            .map(|session| {
                session
                    .downloads
                    .iter()
                    .filter(|item| {
                        item.url == url.as_str()
                            && item.state == "requested"
                            && path.is_none_or(|path| Path::new(&item.path) == path)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if matches.len() == 1 {
            matches.into_iter().next()
        } else {
            None
        }
    };
    let resolved_path = pending.as_ref().map(|item| Path::new(&item.path));
    let success = success
        && resolved_path.is_some_and(|path| fs::metadata(path).is_ok_and(|meta| meta.is_file()));
    let file = if success {
        resolved_path
            .and_then(|path| crate::browser::agent_pages::task_files::fingerprint(path).ok())
    } else {
        None
    };
    let mut sessions = state
        .sessions
        .lock()
        .expect("browser session mutex poisoned");
    let session = sessions.entry(tab_id.to_owned()).or_default();
    let path_text = resolved_path
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let existing = session.downloads.iter_mut().rev().find(|item| {
        pending
            .as_ref()
            .is_some_and(|pending| item.download_id == pending.download_id)
            && item.state == "requested"
    });
    let record = if let Some(item) = existing {
        item.path = path_text.clone();
        item.state = if success { "finished" } else { "failed" }.to_owned();
        item.success = success;
        item.file = file;
        if !success {
            item.error = Some("The native WebView reported that the download failed.".to_owned());
        }
        item.clone()
    } else {
        BrowserDownload {
            download_id: format!("download-{}", uuid::Uuid::new_v4()),
            tab_id: tab_id.to_owned(),
            url: url.to_string(),
            path: path_text.clone(),
            state: if success { "finished" } else { "failed" }.to_owned(),
            success,
            initiator: "human".to_owned(),
            agent_id: None,
            grant_id: None,
            task_id: None,
            file: None,
            error: (!success)
                .then(|| "The native WebView reported that the download failed.".to_owned()),
        }
    };
    drop(sessions);
    if let Ok(mut reserved) = state.reserved_downloads.lock() {
        if !path_text.is_empty() {
            reserved.remove(Path::new(&path_text));
        }
    }
    record
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTabDownloadOpenRequest {
    pub tab_id: String,
    pub download_id: String,
}

/// Opens a finished download from a tab's own history, for files an agent downloaded, which stay out
/// of the person's download list. The path comes from that history, never from the window asking.
#[tauri::command]
pub fn browser_tab_download_open(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserTabDownloadOpenRequest,
) -> Result<(), String> {
    let path = state
        .sessions
        .lock()
        .map_err(|_| "The download list is unavailable.".to_owned())?
        .get(&request.tab_id)
        .and_then(|session| {
            session
                .downloads
                .iter()
                .find(|item| item.download_id == request.download_id && item.success)
                .map(|item| item.path.clone())
        })
        .ok_or_else(|| "This download is no longer available.".to_owned())?;
    if !fs::is_file(&path) {
        return Err("The file was moved or deleted.".to_owned());
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path, None::<&str>)
        .map_err(|error| error.to_string())
}
