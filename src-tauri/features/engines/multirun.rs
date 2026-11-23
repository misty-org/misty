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

pub(crate) fn is_worktree(db: &database::store::Store, account: &str, folder: &Path) -> bool {
    store::is_worktree(db, account, folder)
}

pub(crate) fn worktree_folders(db: &database::store::Store) -> Vec<PathBuf> {
    store::all_paths(db)
}

fn is_commit(text: &str) -> bool {
    matches!(text.len(), 40 | 64) && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

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

fn plain(text: &str) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() || text.len() > 200 || text.chars().any(char::is_control) {
        return Err("That multi-run can't be started.".into());
    }
    Ok(text.to_string())
}

fn root(misty_root: &Path) -> PathBuf {
    misty_root
        .join(file_access::paths::SHARED_FOLDER)
        .join("multirun")
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
    folder: String,
    branch: String,
    kept: bool,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Multirun {
    id: String,
    task: String,
    folder: String,
    created_at: i64,
    lanes: Vec<Lane>,
}

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
    let index = worktree.with_extension("index");
    crate::project::git::changes_since(&worktree, &index, &row.base).await
}

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
    let kept_at = worktrees::head(&worktree).await?;
    let db = state.environment.store();
    blocking(move || {
        store::mark_kept(&db, &row.account, &row.multirun, row.lane)?;
        store::set_base(&db, &row.account, &row.multirun, row.lane, &kept_at)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadLane {
    multirun: String,
    lane: i64,
    branch: String,
    folder: String,
    project: String,
}

pub(crate) fn lane_folder(
    db: &database::store::Store,
    account: &str,
    conversation: &str,
) -> Option<PathBuf> {
    store::of_conversation(db, account, conversation)
        .map(|row| PathBuf::from(row.path))
        .filter(|path| file_access::fs::is_dir(path))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn thread_lane(
    db: &database::store::Store,
    misty_root: &Path,
    account: &str,
    space: &str,
    agent: &str,
    conversation: &str,
    project: &Path,
    title: &str,
) -> Option<PathBuf> {
    if conversation.is_empty() {
        return None;
    }
    let found = {
        let (db, account, conversation) =
            (db.clone(), account.to_string(), conversation.to_string());
        blocking(move || Ok(store::of_conversation(&db, &account, &conversation)))
            .await
            .ok()
            .flatten()
    };
    if let Some(row) = found {
        let path = PathBuf::from(&row.path);
        if file_access::fs::is_dir(&path) {
            return Some(path);
        }
        let (db, account, multirun) = (db.clone(), row.account.clone(), row.multirun.clone());
        let _ = blocking(move || store::delete(&db, &account, &multirun)).await;
    }
    if worktrees::readiness(project).await.ok()? != "ready" {
        return None;
    }
    let base = worktrees::head(project).await.ok()?;
    let id = new_id();
    let home = root(misty_root).join(&id);
    file_access::fs::create_dir_all(&home).ok()?;
    let home = file_access::fs::canonicalize(&home).ok()?;
    let path = home.join("1");
    let branch = format!("misty/thread-{id}");
    let task = plain(title).unwrap_or_else(|_| "Thread".to_string());
    let row = Row {
        account: account.to_string(),
        multirun: id,
        lane: 1,
        space: super::commands::space_key(space).unwrap_or_default(),
        folder: project.to_string_lossy().to_string(),
        path: path.to_string_lossy().to_string(),
        branch: branch.clone(),
        base: base.clone(),
        agent: agent.to_string(),
        conversation: conversation.to_string(),
        task,
        kept: false,
        created_at: now(),
    };
    if worktrees::add(project, &path, &branch, &base)
        .await
        .is_err()
    {
        take_down(&home, std::slice::from_ref(&row)).await;
        return None;
    }
    file_access::allow_linked_folder(&path);
    let (db, kept) = (db.clone(), vec![row.clone()]);
    if blocking(move || store::insert(&db, &kept)).await.is_err() {
        take_down(&home, &[row]).await;
        return None;
    }
    Some(path)
}

#[tauri::command]
pub async fn thread_lane_of(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<Option<ThreadLane>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        Ok(
            store::of_conversation(&db, &account, &conversation).map(|row| ThreadLane {
                multirun: row.multirun,
                lane: row.lane,
                branch: row.branch,
                folder: row.path,
                project: row.folder,
            }),
        )
    })
    .await
}

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
        super::runs::end_warm_in(Path::new(&row.path));
    }
    if stopped {
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
    let home = root(&state.environment.misty_root()).join(&multirun);
    let home = file_access::fs::canonicalize(&home).unwrap_or(home);
    take_down(&home, &rows).await;
    let db = state.environment.store();
    blocking(move || store::delete(&db, &account, &multirun)).await
}
