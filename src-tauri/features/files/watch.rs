// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Live refresh of the folders open in Files: each one is watched on its own (not its subfolders),
//! counted per `files_watch` so two views of one folder share a watch, and a burst of changes is
//! told once, as `files://changed {path}`, after it goes quiet for a moment.
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{mpsc, LazyLock, Mutex},
    time::{Duration, Instant},
};

use file_access::disk::{check_disk, fs_disk};
use file_access::Access;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::{asked_path, blocking, failed, person_window};

pub const EVENT: &str = "files://changed";

/// Quiet time after the last change before a folder is told.
const DEBOUNCE: Duration = Duration::from_millis(150);
/// A folder that never goes quiet is still told this often.
const MAX_DELAY: Duration = Duration::from_secs(1);

#[derive(Clone, Serialize)]
struct FolderChange {
    path: String,
}

struct Watched {
    /// The path as the window named it, which the event carries back.
    asked: String,
    count: usize,
}

struct State {
    watcher: RecommendedWatcher,
    /// By the folder's real path, which is what the system reports changes under.
    folders: HashMap<PathBuf, Watched>,
}

static STATE: LazyLock<Mutex<Option<State>>> = LazyLock::new(Mutex::default);

fn state() -> std::sync::MutexGuard<'static, Option<State>> {
    STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Starts the watcher and the thread that tells the windows, the first time a folder is watched.
fn started(app: &AppHandle) -> Result<(), String> {
    let mut guard = state();
    if guard.is_some() {
        return Ok(());
    }
    let (sender, receiver) = mpsc::channel::<PathBuf>();
    let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        for path in event.paths {
            // A change to an item refreshes the folder listing it; a change to the folder itself
            // (renamed, removed) refreshes it too.
            if let Some(parent) = path.parent() {
                let _ = sender.send(parent.to_path_buf());
            }
            let _ = sender.send(path);
        }
    })
    .map_err(|error| format!("Files couldn't watch folders: {error}"))?;
    let app = app.clone();
    std::thread::Builder::new()
        .name("files-watch".into())
        .spawn(move || coalesce(receiver, &app))
        .map_err(|error| format!("Files couldn't watch folders: {error}"))?;
    *guard = Some(State {
        watcher,
        folders: HashMap::new(),
    });
    Ok(())
}

/// Collects changed paths until they go quiet, then tells each watched folder among them once.
fn coalesce(receiver: mpsc::Receiver<PathBuf>, app: &AppHandle) {
    while let Ok(first) = receiver.recv() {
        let started = Instant::now();
        let mut changed = HashSet::from([first]);
        loop {
            let left = MAX_DELAY.saturating_sub(started.elapsed());
            match receiver.recv_timeout(DEBOUNCE.min(left)) {
                Ok(path) => {
                    changed.insert(path);
                    if started.elapsed() >= MAX_DELAY {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
        let told: Vec<String> = {
            let guard = state();
            let Some(state) = guard.as_ref() else { continue };
            changed
                .iter()
                .filter_map(|path| state.folders.get(path))
                .map(|watched| watched.asked.clone())
                .collect()
        };
        for path in told {
            let _ = app.emit(EVENT, FolderChange { path });
        }
    }
}

fn real_folder(path: &Path) -> std::io::Result<PathBuf> {
    check_disk(path, Access::Read)?;
    if !fs_disk::is_dir(path) {
        return Err(std::io::Error::other("That isn't a folder."));
    }
    fs_disk::canonicalize(path)
}

/// Starts telling `files://changed` for this folder. Watching it again only counts once more.
#[tauri::command]
pub async fn files_watch(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let folder = asked_path(&path)?;
    blocking(move || {
        let real = real_folder(&folder)
            .map_err(|error| failed(&folder, super::listing::io_text(&error)))?;
        started(&app)?;
        let mut guard = state();
        let Some(state) = guard.as_mut() else {
            return Err("Files couldn't watch folders.".into());
        };
        if let Some(watched) = state.folders.get_mut(&real) {
            watched.count += 1;
            return Ok(());
        }
        state
            .watcher
            .watch(&real, RecursiveMode::NonRecursive)
            .map_err(|error| failed(&folder, error))?;
        state.folders.insert(real, Watched { asked: path, count: 1 });
        Ok(())
    })
    .await
}

/// Stops one `files_watch` of this folder; the last one stops watching it.
#[tauri::command]
pub async fn files_unwatch(webview: tauri::Webview, path: String) -> Result<(), String> {
    person_window(&webview)?;
    let folder = asked_path(&path)?;
    blocking(move || {
        let mut guard = state();
        let Some(state) = guard.as_mut() else {
            return Ok(());
        };
        // The folder may be gone by now, so it is found by the path it was watched under too.
        let real = fs_disk::canonicalize(&folder)
            .ok()
            .filter(|real| state.folders.contains_key(real));
        let real = real.or_else(|| {
            state
                .folders
                .iter()
                .find(|(_, watched)| watched.asked == path)
                .map(|(real, _)| real.clone())
        });
        let Some(real) = real else { return Ok(()) };
        let last = state.folders.get_mut(&real).is_some_and(|watched| {
            watched.count = watched.count.saturating_sub(1);
            watched.count == 0
        });
        if last {
            state.folders.remove(&real);
            let _ = state.watcher.unwatch(&real);
        }
        Ok(())
    })
    .await
}
