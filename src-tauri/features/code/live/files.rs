//! A session's files on disk: a file as it was at the base commit, writing the shared text into
//! the person's worktree, and noticing edits made there outside Misty (an agent, a formatter, the
//! terminal) so the window can fold them into the shared text.
//!
//! The crate has no file-watch helper, so the worktree is polled: the session's files by their
//! modified time and size every `POLL`, and Git's status every few rounds to find files changed
//! that the session doesn't have yet. What Misty wrote itself is remembered by its content, so
//! its own writes never come back as outside edits. A write never overwrites an outside edit the
//! poll hasn't reported yet: it hands that edit back instead, and the window writes again after
//! folding it in.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{Emitter, Manager};

use super::git::open_repo;
use super::{blocking, commit_id, repo_file, session_branch};
use crate::project::{linked_path, person_window};

pub const FILE_CHANGED_EVENT: &str = "misty://code-live-file-changed";

/// How often the session's files are looked at.
const POLL: Duration = Duration::from_millis(750);
/// Every this many polls, Git's status is read for files the session doesn't have yet.
const STATUS_EVERY: u32 = 4;
/// Larger files aren't edited live.
const MOST_BYTES: u64 = 2 * 1024 * 1024;

/// What Misty last knew a file to be: its stamp on disk and its content's hash.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Seen {
    stamp: Option<(SystemTime, u64)>,
    hash: Option<u64>,
}

#[derive(Default)]
struct Folder {
    /// The folder as the window named it, which the window's events carry back.
    named: String,
    window: Option<String>,
    files: HashMap<String, Seen>,
    stop: Option<Arc<AtomicBool>>,
}

static FOLDERS: LazyLock<parking_lot::Mutex<HashMap<PathBuf, Folder>>> =
    LazyLock::new(|| parking_lot::Mutex::new(HashMap::new()));

fn hash_of(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

fn stamp_of(path: &Path) -> Option<(SystemTime, u64)> {
    let meta = file_access::fs::metadata(path).ok()?;
    meta.is_file().then(|| {
        (
            meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            meta.len(),
        )
    })
}

/// A file's text, if it is there, small and UTF-8. Anything else isn't edited live.
fn read_text(path: &Path) -> Option<String> {
    let (_, len) = stamp_of(path)?;
    if len > MOST_BYTES {
        return None;
    }
    String::from_utf8(file_access::fs::read(path).ok()?).ok()
}

/// Stops watching a worktree and forgets what was known of it, before it is removed.
pub(super) fn forget(folder: &Path) {
    let real = file_access::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    if let Some(gone) = FOLDERS.lock().remove(&real) {
        if let Some(stop) = gone.stop {
            stop.store(true, Ordering::SeqCst);
        }
    }
}

/// A session worktree named by a window: linked, the top of its checkout, on a session branch.
pub(super) async fn live_worktree(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    account: &str,
    folder: &str,
) -> Result<PathBuf, String> {
    person_window(webview)?;
    let real = linked_path(app, account, folder).await?;
    blocking(move || {
        let repo = open_repo(&real)?;
        let top = repo
            .workdir()
            .and_then(|top| file_access::fs::canonicalize(top).ok())
            .ok_or("That isn't a live session's worktree.")?;
        let branch = repo
            .head()
            .ok()
            .filter(|head| head.is_branch())
            .and_then(|head| head.shorthand().map(str::to_string))
            .unwrap_or_default();
        if top != real || session_branch(&branch).is_err() {
            return Err("That isn't a live session's worktree.".into());
        }
        Ok(real)
    })
    .await
}

/// A file as it was at the session's base commit; none when it didn't exist then.
#[tauri::command]
pub async fn code_live_base_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    base_commit: String,
    path: String,
) -> Result<Option<String>, String> {
    let top = live_worktree(&app, &webview, &account, &folder).await?;
    let base = commit_id(&base_commit)?;
    let file = repo_file(&path)?;
    blocking(move || {
        let repo = open_repo(&top)?;
        let tree = repo
            .find_commit(base)
            .and_then(|commit| commit.tree())
            .map_err(|_| "The session's starting commit isn't in this copy.".to_string())?;
        let Ok(entry) = tree.get_path(&file) else {
            return Ok(None);
        };
        let blob = entry
            .to_object(&repo)
            .and_then(|object| object.peel_to_blob())
            .map_err(|_| "That's a folder, not a file.".to_string())?;
        if blob.is_binary() || blob.size() as u64 > MOST_BYTES {
            return Err("This file isn't text, so it can't be edited live.".into());
        }
        String::from_utf8(blob.content().to_vec())
            .map(Some)
            .map_err(|_| "This file isn't text, so it can't be edited live.".to_string())
    })
    .await
}

/// Writes the shared text of a file into the worktree. Returns the file's text instead, without
/// writing, when it was changed outside Misty since Misty last knew it: the window folds that
/// edit into the shared text first and writes again.
#[tauri::command]
pub async fn code_live_write(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    path: String,
    text: String,
) -> Result<Option<String>, String> {
    let top = live_worktree(&app, &webview, &account, &folder).await?;
    let file = repo_file(&path)?;
    blocking(move || {
        let target = top.join(&file);
        // Held across the read and the write, so the poll can't slip in between.
        let mut folders = FOLDERS.lock();
        let entry = folders.entry(top.clone()).or_default();
        let known = entry.files.get(&path).copied().unwrap_or_default();
        let current = read_text(&target);
        let wanted = hash_of(&text);
        if let Some(current) = current {
            let now = hash_of(&current);
            if now == wanted {
                entry.files.insert(
                    path,
                    Seen {
                        stamp: stamp_of(&target),
                        hash: Some(now),
                    },
                );
                return Ok(None);
            }
            if known.hash.is_some_and(|hash| hash != now) {
                entry.files.insert(
                    path,
                    Seen {
                        stamp: stamp_of(&target),
                        hash: Some(now),
                    },
                );
                return Ok(Some(current));
            }
        }
        if let Some(parent) = target.parent() {
            file_access::fs::create_dir_all(parent)
                .map_err(|error| format!("{path} couldn't be written: {error}"))?;
        }
        file_access::fs::write(&target, text.as_bytes())
            .map_err(|error| format!("{path} couldn't be written: {error}"))?;
        entry.files.insert(
            path,
            Seen {
                stamp: stamp_of(&target),
                hash: Some(wanted),
            },
        );
        Ok(None)
    })
    .await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChanged {
    folder: String,
    path: String,
    /// The file's new text; none when it was removed.
    text: Option<String>,
}

/// Files the worktree changed that the session doesn't know yet, from Git's status.
fn status_paths(top: &Path) -> Vec<String> {
    let Ok(repo) = git2::Repository::open(top) else {
        return Vec::new();
    };
    let mut options = git2::StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let Ok(statuses) = repo.statuses(Some(&mut options)) else {
        return Vec::new();
    };
    statuses
        .iter()
        .filter(|entry| !entry.status().contains(git2::Status::WT_DELETED))
        .filter_map(|entry| entry.path().map(str::to_string))
        .filter(|path| repo_file(path).is_ok())
        .collect()
}

/// One look at a worktree: every file whose content moved away from what Misty knew.
fn poll_once(top: &Path, with_status: bool) -> Vec<FileChanged> {
    let discovered = if with_status {
        status_paths(top)
    } else {
        Vec::new()
    };
    let mut folders = FOLDERS.lock();
    let Some(entry) = folders.get_mut(top) else {
        return Vec::new();
    };
    for path in discovered {
        entry.files.entry(path).or_default();
    }
    let mut changed = Vec::new();
    for (path, seen) in entry.files.iter_mut() {
        let target = top.join(path);
        let stamp = stamp_of(&target);
        if stamp == seen.stamp && seen.hash.is_some() {
            continue;
        }
        match stamp {
            None => {
                if seen.hash.is_some() {
                    *seen = Seen::default();
                    changed.push(FileChanged {
                        folder: entry.named.clone(),
                        path: path.clone(),
                        text: None,
                    });
                }
            }
            Some(_) => {
                let Some(text) = read_text(&target) else {
                    *seen = Seen {
                        stamp,
                        hash: seen.hash,
                    };
                    continue;
                };
                let hash = hash_of(&text);
                let moved = seen.hash != Some(hash);
                *seen = Seen {
                    stamp,
                    hash: Some(hash),
                };
                if moved {
                    changed.push(FileChanged {
                        folder: entry.named.clone(),
                        path: path.clone(),
                        text: Some(text),
                    });
                }
            }
        }
    }
    changed
}

/// Watches a session worktree for edits made outside Misty, reported to this window as
/// `misty://code-live-file-changed`. `paths` are the session's files, taken as they are on disk
/// now; files Git then sees changed are reported as they appear. Watching again replaces the list.
#[tauri::command]
pub async fn code_live_watch(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
    paths: Vec<String>,
) -> Result<(), String> {
    let top = live_worktree(&app, &webview, &account, &folder).await?;
    for path in &paths {
        repo_file(path)?;
    }
    let window = webview.label().to_string();
    let stop = {
        let top = top.clone();
        blocking(move || {
            let mut folders = FOLDERS.lock();
            let entry = folders.entry(top.clone()).or_default();
            entry.named = folder;
            entry.window = Some(window);
            for path in paths {
                let target = top.join(&path);
                let seen = entry.files.entry(path).or_default();
                if seen.hash.is_none() {
                    *seen = Seen {
                        stamp: stamp_of(&target),
                        hash: read_text(&target).map(|text| hash_of(&text)),
                    };
                }
            }
            if entry.stop.is_some() {
                return Ok(None);
            }
            let stop = Arc::new(AtomicBool::new(false));
            entry.stop = Some(Arc::clone(&stop));
            Ok(Some(stop))
        })
        .await?
    };
    let Some(stop) = stop else {
        return Ok(());
    };
    tauri::async_runtime::spawn(async move {
        let mut round = 0u32;
        while !stop.load(Ordering::SeqCst) {
            tokio::time::sleep(POLL).await;
            round = round.wrapping_add(1);
            let at = top.clone();
            let with_status = round.is_multiple_of(STATUS_EVERY);
            let Ok(changed) =
                tokio::task::spawn_blocking(move || poll_once(&at, with_status)).await
            else {
                continue;
            };
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let window = FOLDERS
                .lock()
                .get(&top)
                .and_then(|entry| entry.window.clone());
            if let Some(window) = window {
                // A window that closed without saying so stops its watch.
                if app.get_webview(&window).is_none() {
                    forget(&top);
                    break;
                }
                for change in changed {
                    let _ = app.emit_to(window.as_str(), FILE_CHANGED_EVENT, change);
                }
            }
        }
    });
    Ok(())
}

/// Stops watching a session worktree.
#[tauri::command]
pub async fn code_live_unwatch(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let real = linked_path(&app, &account, &folder).await?;
    blocking(move || {
        forget(&real);
        Ok(())
    })
    .await
}
