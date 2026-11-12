//! Rewinding a chat with its files (`turn_snapshots.rs` keeps the trees). Every turn on this
//! computer starts through `agent_run_start`, whatever engine runs it, so the folder it works in is
//! saved there before it begins and again when its end is published. The window asks what a
//! rewind would put back, then asks for the files the person agreed to; native code works out the
//! contents again itself and only ever writes inside the folder the turns worked in.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Webview};

use super::tool_policy::RunFacts;
use super::turn_snapshots::{self as snapshots, FileChange, Record, Turn};
use super::windows::account_of_window;
use crate::app::runtime::MistyRuntime;

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

fn root(app: &AppHandle) -> Option<PathBuf> {
    Some(
        app.try_state::<MistyRuntime>()?
            .environment
            .misty_dir()
            .join("turn-snapshots"),
    )
}

/// One snapshot of a folder at a time, so a turn's end and the next turn's start don't race.
fn folder_lock(folder: &Path) -> Arc<Mutex<()>> {
    static LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
        LazyLock::new(Default::default);
    let key = file_access::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    LOCKS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .entry(key)
        .or_default()
        .clone()
}

fn snapshot_locked(root: &Path, folder: &Path) -> Result<git2::Oid, String> {
    let lock = folder_lock(folder);
    let _held = lock
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    snapshots::snapshot(root, folder)
}

/// The folder a run can change: an engine's linked folder (or its multi-run worktree), or the
/// shared folder Misty's own agent was given to write in. Nothing for a run with neither.
async fn folder_of(app: &AppHandle, account: &str, body: &Value) -> Option<PathBuf> {
    let runtime = app.try_state::<MistyRuntime>()?;
    if crate::engines::runs::wants(body) {
        let folder = PathBuf::from(
            body["engine"]["folder"]
                .as_str()
                .filter(|f| !f.is_empty())?,
        );
        let (db, account, checked) = (
            runtime.environment.store(),
            account.to_owned(),
            folder.clone(),
        );
        // Only a folder the person linked, as the engine itself checks before it starts.
        let linked = tokio::task::spawn_blocking(move || {
            crate::engines::store::is_linked(&db, &account, &checked).unwrap_or(false)
                || crate::engines::multirun::is_worktree(&db, &account, &checked)
        })
        .await
        .unwrap_or(false);
        return (linked && file_access::fs::is_dir(&folder)).then_some(folder);
    }
    let scope = body["device_contexts"].as_array()?.iter().find(|context| {
        context["kind"] == "local_folder"
            && context["capabilities"]
                .as_array()
                .is_some_and(|granted| granted.iter().any(|name| name == "folder.write"))
    })?;
    let scope = scope["opaque_ref"].as_str()?.to_owned();
    runtime.agents.folder_root(scope).await.ok()
}

/// Saves the folder a top-level chat turn works in, before the turn starts. A turn that can't
/// be saved still runs; its files just can't be put back later.
pub(super) async fn before_run(app: &AppHandle, run_id: &str, body: &Value) {
    let facts = RunFacts::of_request(run_id, body);
    let conversation = body["conversation_id"].as_str().unwrap_or("").to_owned();
    if !facts.parent_run_id.is_empty() || facts.planning || conversation.is_empty() {
        return;
    }
    let Some(root) = root(app) else { return };
    let Some(folder) = folder_of(app, &facts.account, body).await else {
        return;
    };
    let run_id = run_id.to_owned();
    let _ = tokio::task::spawn_blocking(move || {
        static PRUNED: std::sync::Once = std::sync::Once::new();
        PRUNED.call_once(|| {
            snapshots::prune(&root, now_ms() - snapshots::KEPT_DAYS * 24 * 60 * 60 * 1000)
        });
        // A run that starts again after a restart keeps the tree it first started from.
        if snapshots::read_record(&root, &run_id).is_some() {
            return;
        }
        let before = snapshot_locked(&root, &folder)
            .ok()
            .map(|id| id.to_string());
        let _ = snapshots::write_record(
            &root,
            &Record {
                run_id,
                account: facts.account,
                conversation,
                folder: folder.to_string_lossy().into_owned(),
                before,
                after: None,
                started_at: now_ms(),
            },
        );
    })
    .await;
}

/// Saves the folder again as a turn ends, off the caller's thread.
pub(super) fn after_run(app: &AppHandle, run_id: &str, event: &Value) {
    let kind = event["type"].as_str().unwrap_or("");
    if !matches!(
        kind,
        "invocation.completed" | "invocation.failed" | "invocation.canceled"
    ) {
        return;
    }
    let Some(root) = root(app) else { return };
    let run_id = run_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(mut record) = snapshots::read_record(&root, &run_id) else {
            return;
        };
        if record.before.is_none() || record.after.is_some() {
            return;
        }
        record.after = snapshot_locked(&root, Path::new(&record.folder))
            .ok()
            .map(|id| id.to_string());
        let _ = snapshots::write_record(&root, &record);
    });
}

/// What a rewind would put back in one folder.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderFiles {
    pub folder: String,
    pub files: Vec<FileChange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindFiles {
    pub folders: Vec<FolderFiles>,
    /// Some removed turn's files weren't saved, so they stay as they are.
    pub incomplete: bool,
}

/// The removed turns' records, grouped by folder in the order the chat ran them.
fn grouped(root: &Path, account: &str, run_ids: &[String]) -> Vec<(String, Vec<Turn>)> {
    let mut groups: Vec<(String, Vec<Turn>)> = Vec::new();
    for run_id in run_ids {
        let Some(record) = snapshots::read_record(root, run_id) else {
            continue;
        };
        if record.account != account {
            continue;
        }
        match groups
            .iter_mut()
            .find(|(folder, _)| *folder == record.folder)
        {
            Some((_, turns)) => turns.push(record.turn()),
            None => groups.push((record.folder.clone(), vec![record.turn()])),
        }
    }
    groups
}

fn plans(
    root: &Path,
    account: &str,
    run_ids: &[String],
) -> Vec<(String, Result<snapshots::Plan, String>)> {
    grouped(root, account, run_ids)
        .into_iter()
        .map(|(folder, turns)| {
            let path = PathBuf::from(&folder);
            let plan = (|| {
                // A folder Misty may only read (a shared folder, which only the chat's sandboxed
                // shell writes) can't have its files put back from here.
                file_access::check(&path, file_access::Access::Write)
                    .map_err(|error| error.to_string())?;
                let now = snapshot_locked(root, &path)?;
                let repository = snapshots::repository(root, &path)?;
                snapshots::plan(&repository, &turns, now)
            })();
            (folder, plan)
        })
        .collect()
}

fn window_account(webview: &Webview) -> Result<String, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can rewind a chat.".into());
    }
    account_of_window(webview.label()).ok_or_else(|| "This window has no account.".into())
}

/// What rewinding these turns (oldest first) would put back.
#[tauri::command]
pub async fn agent_turn_files(
    app: AppHandle,
    webview: Webview,
    run_ids: Vec<String>,
) -> Result<RewindFiles, String> {
    let account = window_account(&webview)?;
    let root = root(&app).ok_or("Misty isn't ready yet.")?;
    tokio::task::spawn_blocking(move || {
        let mut incomplete = false;
        let mut folders = Vec::new();
        for (folder, plan) in plans(&root, &account, &run_ids) {
            match plan {
                Ok(plan) => {
                    incomplete |= plan.incomplete;
                    if !plan.files.is_empty() {
                        folders.push(FolderFiles {
                            folder,
                            files: plan.files,
                        });
                    }
                }
                Err(_) => incomplete = true,
            }
        }
        RewindFiles {
            folders,
            incomplete,
        }
    })
    .await
    .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
pub struct ChosenFile {
    pub folder: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredFiles {
    pub restored: usize,
    /// Files that couldn't be put back, as `folder/path`.
    pub failed: Vec<String>,
}

/// Puts back the files the person chose from what rewinding these turns would put back.
#[tauri::command]
pub async fn agent_turn_restore(
    app: AppHandle,
    webview: Webview,
    run_ids: Vec<String>,
    files: Vec<ChosenFile>,
) -> Result<RestoredFiles, String> {
    let account = window_account(&webview)?;
    let root = root(&app).ok_or("Misty isn't ready yet.")?;
    tokio::task::spawn_blocking(move || {
        let mut outcome = RestoredFiles {
            restored: 0,
            failed: Vec::new(),
        };
        for (folder, plan) in plans(&root, &account, &run_ids) {
            let Ok(plan) = plan else { continue };
            let Some(target) = plan.target else { continue };
            // Only files this rewind would put back, whatever the window sends.
            let chosen: Vec<String> = plan
                .files
                .iter()
                .filter(|file| {
                    files
                        .iter()
                        .any(|pick| pick.folder == folder && pick.path == file.path)
                })
                .map(|file| file.path.clone())
                .collect();
            if chosen.is_empty() {
                continue;
            }
            let path = PathBuf::from(&folder);
            let lock = folder_lock(&path);
            let _held = lock
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let failed = snapshots::restore(&root, &path, target, &chosen)
                .unwrap_or_else(|_| chosen.clone());
            outcome.restored += chosen.len() - failed.len();
            outcome
                .failed
                .extend(failed.into_iter().map(|file| format!("{folder}/{file}")));
        }
        outcome
    })
    .await
    .map_err(|error| error.to_string())
}
