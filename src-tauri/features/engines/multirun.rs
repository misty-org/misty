//! Multi-run: one task given to several agents at once, each on an outside engine in its own Git
//! worktree of the Space's linked folder, so their changes never meet. The person compares what
//! each did and keeps one, which is folded into the folder staged and uncommitted.
//!
//! The worktrees live under Misty's own folder and are named here, never by a window. A chat
//! turn may run in one because this file recorded it for that account (`is_worktree`), which is
//! the only way a folder that isn't linked becomes somewhere an engine can work. Nothing here
//! pushes, and only what multi-run made is ever removed.
//!
//! The idea follows OpenChamber's multi-run; none of its code is used here.

mod store;
#[cfg(test)]
mod tests;
mod worktrees;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

use crate::app::runtime::MistyRuntime;
use crate::project::git::FileChange;
use crate::project::{linked_path, person_window};

use store::Row;

const MAX_LANES: usize = 4;
const MAX_TASK: usize = 20_000;

/// Whether multi-run made exactly this folder for this account, so a turn may run in it.
pub(crate) fn is_worktree(db: &database::store::Store, account: &str, folder: &Path) -> bool {
    store::is_worktree(db, account, folder)
}

/// Every worktree multi-run has on this computer, for the file gate as the app starts.
pub(crate) fn worktree_folders(db: &database::store::Store) -> Vec<PathBuf> {
    store::all_paths(db)
}

/// A full commit id, as `git rev-parse` prints it.
fn is_commit(text: &str) -> bool {
    matches!(text.len(), 40 | 64) && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// A multi-run's id: ten lowercase hex digits, made here. It becomes part of a folder's and a
/// branch's name, so nothing else is accepted.
fn is_id(text: &str) -> bool {
    text.len() == 10
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..10].to_string()
}

fn branch_name(id: &str, lane: i64) -> String {
    format!("misty/multirun-{id}-{lane}")
}

/// An id a window names (an agent, a chat). It is only ever stored and compared.
fn plain(text: &str) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() || text.len() > 200 || text.chars().any(char::is_control) {
        return Err("That multi-run can't be started.".into());
    }
    Ok(text.to_string())
}

/// `~/.misty/multirun`, shared by every build: each repository knows its worktrees by path.
fn root(misty_root: &Path) -> PathBuf {
    misty_root.join("multirun")
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

fn not_ready(state: &str) -> String {
    match state {
        "no_git" => "Git isn't installed on this computer.",
        "not_repository" => "This folder isn't a Git repository.",
        "not_top_level" => "Link the top folder of this repository to use multi-run.",
        _ => "This repository has no commit yet. Make one, then start a multi-run.",
    }
    .into()
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// An agent chosen for a multi-run, and the chat its turn will be shown in.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneAsk {
    agent_id: String,
    conversation_id: String,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Lane {
    index: i64,
    agent_id: String,
    conversation_id: String,
    /// The worktree, which the lane's chat turns name as their folder.
    folder: String,
    branch: String,
    kept: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Multirun {
    id: String,
    task: String,
    /// The linked folder the lanes were made from.
    folder: String,
    created_at: i64,
    lanes: Vec<Lane>,
}

/// Rows in the store's order (a multi-run's lanes together) as multi-runs.
fn grouped(rows: Vec<Row>) -> Vec<Multirun> {
    let mut runs: Vec<Multirun> = Vec::new();
    for row in rows {
        let lane = Lane {
            index: row.lane,
            agent_id: row.agent,
            conversation_id: row.conversation,
            folder: row.path,
            branch: row.branch,
            kept: row.kept,
        };
        match runs.last_mut() {
            Some(run) if run.id == row.multirun => run.lanes.push(lane),
            _ => runs.push(Multirun {
                id: row.multirun,
                task: row.task,
                folder: row.folder,
                created_at: row.created_at,
                lanes: vec![lane],
            }),
        }
    }
    runs
}

/// Removes the worktrees and branches of `rows` and the folder that held them. `home` is that
/// folder, under Misty's own; a worktree recorded anywhere else is left alone.
async fn take_down(home: &Path, rows: &[Row]) {
    for row in rows {
        let (folder, path) = (Path::new(&row.folder), Path::new(&row.path));
        if path.starts_with(home) && file_access::fs::is_dir(folder) {
            worktrees::remove(folder, path, &row.branch).await;
        }
        file_access::revoke_linked_folder(path);
    }
    if file_access::fs::is_dir(home) {
        let _ = file_access::fs::remove_dir_all(home);
    }
}

async fn lane_of(
    state: &State<'_, MistyRuntime>,
    account: &str,
    multirun: &str,
    lane: i64,
) -> Result<Row, String> {
    let (db, account, multirun) = (
        state.environment.store(),
        account.to_string(),
        multirun.to_string(),
    );
    blocking(move || store::of_run(&db, &account, &multirun))
        .await?
        .into_iter()
        .find(|row| row.lane == lane)
        .ok_or_else(|| "That run isn't part of a multi-run on this computer.".to_string())
}

/// Whether the linked folder can take a multi-run: `ready`, or what is in the way.
#[tauri::command]
pub async fn multirun_check(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    folder: String,
) -> Result<&'static str, String> {
    person_window(&webview)?;
    let folder = linked_path(&app, &account, &folder).await?;
    worktrees::readiness(&folder).await
}

/// Makes a worktree and a branch for each chosen agent, from the commit the folder is on, and
/// records them. The window then starts each agent's chat turn in its lane's folder.
#[tauri::command]
pub async fn multirun_start(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
    folder: String,
    task: String,
    lanes: Vec<LaneAsk>,
) -> Result<Multirun, String> {
    person_window(&webview)?;
    let app = webview.app_handle().clone();
    let space = super::commands::space_key(&space)?;
    let task = task.trim().to_string();
    if task.is_empty() || task.len() > MAX_TASK {
        return Err("Write the task, in fewer than 20,000 characters.".into());
    }
    if lanes.is_empty() || lanes.len() > MAX_LANES {
        return Err("Choose one to four agents.".into());
    }
    let mut asked = Vec::new();
    for lane in &lanes {
        asked.push((plain(&lane.agent_id)?, plain(&lane.conversation_id)?));
    }
    let folder = linked_path(&app, &account, &folder).await?;
    let ready = worktrees::readiness(&folder).await?;
    if ready != "ready" {
        return Err(not_ready(ready));
    }
    let base = worktrees::head(&folder).await?;
    let id = new_id();
    let home = root(&state.environment.misty_root()).join(&id);
    file_access::fs::create_dir_all(&home).map_err(|error| error.to_string())?;
    let home = file_access::fs::canonicalize(&home).map_err(|error| error.to_string())?;
    let created_at = now();
    let mut rows: Vec<Row> = Vec::new();
    for (position, (agent, conversation)) in asked.into_iter().enumerate() {
        let lane = position as i64 + 1;
        let (path, branch) = (home.join(lane.to_string()), branch_name(&id, lane));
        let row = Row {
            account: account.clone(),
            multirun: id.clone(),
            lane,
            space: space.clone(),
            folder: folder.to_string_lossy().to_string(),
            path: path.to_string_lossy().to_string(),
            branch: branch.clone(),
            base: base.clone(),
            agent,
            conversation,
            task: task.clone(),
            kept: false,
            created_at,
        };
        let added = worktrees::add(&folder, &path, &branch, &base).await;
        rows.push(row);
        if let Err(error) = added {
            take_down(&home, &rows).await;
            return Err(error);
        }
        file_access::allow_linked_folder(&path);
    }
    let (db, kept) = (state.environment.store(), rows.clone());
    if let Err(error) = blocking(move || store::insert(&db, &kept)).await {
        take_down(&home, &rows).await;
        return Err(error);
    }
    grouped(rows)
        .pop()
        .ok_or_else(|| "That multi-run can't be started.".to_string())
}

/// A Space's multi-runs on this computer, newest first.
#[tauri::command]
pub async fn multirun_list(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
) -> Result<Vec<Multirun>, String> {
    person_window(&webview)?;
    let (db, space) = (
        state.environment.store(),
        super::commands::space_key(&space)?,
    );
    blocking(move || store::of_space(&db, &account, &space))
        .await
        .map(grouped)
}

/// What one lane changed since the multi-run started: each file, with its diff.
#[tauri::command]
pub async fn multirun_changes(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    multirun: String,
    lane: i64,
) -> Result<Vec<FileChange>, String> {
    person_window(&webview)?;
    let row = lane_of(&state, &account, &multirun, lane).await?;
    let worktree = PathBuf::from(&row.path);
    if !file_access::fs::is_dir(&worktree) || !is_commit(&row.base) {
        return Err("This run's folder is gone.".into());
    }
    // Beside the worktree, not in it: `<home>/<lane>.index`.
    let index = worktree.with_extension("index");
    crate::project::git::changes_since(&worktree, &index, &row.base).await
}

/// Keeps one lane: its work is folded into the linked folder, staged and not committed, for the
/// person to review and commit in the changes panel.
#[tauri::command]
pub async fn multirun_keep(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    multirun: String,
    lane: i64,
) -> Result<(), String> {
    person_window(&webview)?;
    let row = lane_of(&state, &account, &multirun, lane).await?;
    // The folder must still be one this account links.
    let folder = linked_path(&app, &account, &row.folder).await?;
    let worktree = PathBuf::from(&row.path);
    if !file_access::fs::is_dir(&worktree) || !is_commit(&row.base) {
        return Err("This run's folder is gone.".into());
    }
    if !super::runs::live_in(&worktree).is_empty() {
        return Err("This agent is still working. Stop it or wait, then keep its run.".into());
    }
    let label = format!("Multi-run {}, run {}", row.multirun, row.lane);
    worktrees::keep(&folder, &worktree, &row.base, &label).await?;
    let db = state.environment.store();
    blocking(move || store::mark_kept(&db, &row.account, &row.multirun, row.lane)).await
}

/// Discards a multi-run: stops what still runs in it, then removes its worktrees and branches.
/// The chats stay, and so does anything already kept in the linked folder.
#[tauri::command]
pub async fn multirun_discard(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    multirun: String,
) -> Result<(), String> {
    person_window(&webview)?;
    if !is_id(&multirun) {
        return Err("That isn't a multi-run on this computer.".into());
    }
    let (db, owner, id) = (state.environment.store(), account.clone(), multirun.clone());
    let rows = blocking(move || store::of_run(&db, &owner, &id)).await?;
    if rows.is_empty() {
        return Ok(());
    }
    let mut stopped = false;
    for row in &rows {
        for run in super::runs::live_in(Path::new(&row.path)) {
            stopped |= super::runs::cancel(&run);
        }
    }
    if stopped {
        // An engine told to stop takes a moment to let go of its folder.
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    let home = root(&state.environment.misty_root()).join(&multirun);
    let home = file_access::fs::canonicalize(&home).unwrap_or(home);
    take_down(&home, &rows).await;
    let db = state.environment.store();
    blocking(move || store::delete(&db, &account, &multirun)).await
}
