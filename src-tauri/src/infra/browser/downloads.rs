//! Download events, destinations and history for browser pages.

use super::*;

mod settings;
pub use settings::*;

pub(super) fn handle_download_event(
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
            if let Err(error) = std::fs::create_dir_all(&download_dir) {
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
            #[cfg(any(target_os = "macos", windows))]
            let path = if !agent_download && ask_download_location() {
                if let Ok(mut reserved) = state.reserved_downloads.lock() {
                    reserved.remove(&path);
                }
                let Some(chosen) = super::super::browser_macos::ask_download_destination(&path)
                else {
                    return false;
                };
                // The save dialog already confirmed replacing an existing file,
                // and the engine will not write over one.
                if chosen.is_file() {
                    let _ = std::fs::remove_file(&chosen);
                }
                if let Ok(mut reserved) = state.reserved_downloads.lock() {
                    reserved.insert(chosen.clone());
                }
                chosen
            } else {
                path
            };
            *destination = path.clone();
            let record = requested_download(&state, tab_id, &url, &path);
            if record.initiator == "human" && !tab_is_private(&state, tab_id) {
                super::super::browser_library::download_started(
                    app,
                    &record.download_id,
                    &record.url,
                    &path,
                );
            }
            let _ = app.emit_to(
                browser_owner_label(app, tab_id),
                "misty://browser-download",
                record,
            );
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let record = finish_download(&state, tab_id, &url, path.as_deref(), success);
            if record.initiator == "human" {
                super::super::browser_library::download_finished(
                    app,
                    &record.download_id,
                    record.success,
                    record.error.as_deref(),
                );
                // Private tabs have no Space store; their downloads stay here.
                if let (true, Some(kiri::engine::StoreScope::Persistent(store_key))) =
                    (record.success, session_permission_scope(app, tab_id))
                {
                    super::super::browser_library::download_into_space(
                        app,
                        store_key,
                        &record.download_id,
                    );
                }
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

pub(super) fn tab_is_private(state: &BrowserSessionState, tab_id: &str) -> bool {
    state
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(tab_id).map(|session| session.private))
        .unwrap_or(false)
}

pub(super) fn emit_download_failure(
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
    super::super::browser_library::download_failed(app, &record.download_id, &record.url, error);
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

pub(super) fn requested_download(
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

pub(super) fn finish_download(
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
        && resolved_path
            .is_some_and(|path| std::fs::metadata(path).is_ok_and(|meta| meta.is_file()));
    let file = if success {
        resolved_path.and_then(|path| task_files::fingerprint(path).ok())
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
