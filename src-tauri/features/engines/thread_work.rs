use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use database::store::Store;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use space_drive::ignore::DriveRules;
use space_drive::{names, Drive, SpaceId, StatusKind};
use tauri::{AppHandle, Emitter, Manager, State};

use super::commands::{blocking, person_window};
use crate::app::runtime::MistyRuntime;

#[path = "thread_work_land.rs"]
mod land;
pub(crate) use land::land;

const ROOT: &str = "threads";
const META: &str = ".meta";
const AGENTS: &str = "Agents";
const PULL_MOST: u64 = 512 * 1024 * 1024;
const NAME_MOST: usize = 80;
pub(crate) const EVENT: &str = "thread-work-changed";

#[derive(Clone, Debug)]
pub(crate) struct Place {
    pub space: String,
    pub agent_id: String,
    pub agent: String,
    pub title: String,
}

impl Place {
    pub(crate) fn of_request(body: &Value) -> Option<Self> {
        let space = body["engine"]["space"]
            .as_str()
            .filter(|id| !id.is_empty())?;
        let thread = body["engine"]["thread"].as_object()?;
        let text = |key: &str| {
            thread
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        };
        Some(Self {
            space: space.to_string(),
            agent_id: text("agent_id"),
            agent: text("agent"),
            title: text("title"),
        })
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct Clash {
    pub path: String,
    pub kind: String,
}

#[derive(Clone, Debug)]
pub(crate) struct Row {
    pub space: String,
    pub agent_id: String,
    pub folder: String,
    pub state: String,
    pub started: bool,
    pub clashes: Vec<Clash>,
    pub note: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadView {
    conversation_id: String,
    space_id: String,
    folder: String,
    state: String,
    clashes: Vec<Clash>,
    note: String,
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Snapshot {
    pub space: BTreeMap<String, String>,
    pub work: BTreeMap<String, String>,
}

fn text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn data_dir(db: &Store) -> Option<PathBuf> {
    db.path().parent()?.parent().map(Path::to_path_buf)
}

pub(crate) fn root(db: &Store) -> Option<PathBuf> {
    data_dir(db).map(|data| data.join(ROOT))
}

pub(crate) fn workspace(db: &Store, conversation: &str) -> Result<PathBuf, String> {
    let root = root(db).ok_or("Misty couldn't find its data folder.")?;
    Ok(root.join(super::chat_folder::folder_name(conversation)?))
}

fn meta(db: &Store, conversation: &str, suffix: &str) -> Result<PathBuf, String> {
    let root = root(db).ok_or("Misty couldn't find its data folder.")?;
    let name = super::chat_folder::folder_name(conversation)?;
    Ok(root.join(META).join(format!("{name}{suffix}")))
}

pub(crate) fn local_of(root: &Path, path: &str) -> PathBuf {
    names::local_path(root, path)
}

pub(crate) fn drive_path_of(root: &Path, file: &Path) -> Option<String> {
    let relative = file.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for part in relative.components() {
        match part {
            Component::Normal(name) => parts.push(name.to_str()?.to_owned()),
            _ => return None,
        }
    }
    names::drive_path(&parts.join("/")).ok()
}

pub(crate) fn sha_of(path: &Path) -> Option<String> {
    let mut file = file_access::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).ok()?;
    Some(hex::encode(hasher.finalize()))
}

pub(crate) fn walk(root: &Path) -> BTreeMap<String, String> {
    let mut rules = DriveRules::default();
    let mut out = BTreeMap::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Some(at) = drive_path_of(root, &dir) else {
            continue;
        };
        for name in [
            space_drive::ignore::GIT_IGNORE_FILE,
            space_drive::ignore::IGNORE_FILE,
        ] {
            if let Ok(rules_text) = file_access::fs::read_to_string(dir.join(name)) {
                rules.add(&at, &rules_text);
            }
        }
        let Ok(entries) = file_access::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(info) = file_access::fs::symlink_metadata(&path) else {
                continue;
            };
            if info.file_type().is_symlink() {
                continue;
            }
            let Some(drive_path) = drive_path_of(root, &path) else {
                continue;
            };
            if info.is_dir() {
                if !rules.ignores(&drive_path, true) {
                    pending.push(path);
                }
            } else if info.is_file() && !rules.ignores(&drive_path, false) {
                if let Some(sha) = sha_of(&path) {
                    out.insert(drive_path, sha);
                }
            }
        }
    }
    out
}

fn clashes_of(raw: &str) -> Vec<Clash> {
    serde_json::from_str(raw).unwrap_or_default()
}

pub(crate) fn load(db: &Store, account: &str, conversation: &str) -> Result<Option<Row>, String> {
    let connection = db.connect().map_err(text)?;
    let found = connection.query_row(
        "SELECT space_id, agent_id, folder, state, started, clashes, note FROM thread_work
         WHERE account = ?1 AND conversation_id = ?2",
        [account, conversation],
        |row| {
            Ok(Row {
                space: row.get(0)?,
                agent_id: row.get(1)?,
                folder: row.get(2)?,
                state: row.get(3)?,
                started: row.get::<_, i64>(4)? != 0,
                clashes: clashes_of(&row.get::<_, String>(5)?),
                note: row.get(6)?,
            })
        },
    );
    match found {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(text(error)),
    }
}

pub(crate) fn save(db: &Store, account: &str, conversation: &str, row: &Row) -> Result<(), String> {
    let clashes = serde_json::to_string(&row.clashes).map_err(text)?;
    db.connect()
        .map_err(text)?
        .execute(
            "INSERT INTO thread_work (account, conversation_id, space_id, agent_id, folder, state,
                 started, clashes, note, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT (account, conversation_id) DO UPDATE SET space_id = ?3, agent_id = ?4,
                 folder = ?5, state = ?6, started = ?7, clashes = ?8, note = ?9, updated_at = ?10",
            rusqlite::params![
                account,
                conversation,
                row.space,
                row.agent_id,
                row.folder,
                row.state,
                i64::from(row.started),
                clashes,
                row.note,
                now()
            ],
        )
        .map(|_| ())
        .map_err(text)
}

fn folder_taken(db: &Store, space: &str, folder: &str, conversation: &str) -> Result<bool, String> {
    let connection = db.connect().map_err(text)?;
    let found = connection.query_row(
        "SELECT conversation_id FROM thread_work WHERE space_id = ?1 AND folder = ?2",
        [space, folder],
        |row| row.get::<_, String>(0),
    );
    match found {
        Ok(owner) => Ok(owner != conversation),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(error) => Err(text(error)),
    }
}

fn safe_name(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if matches!(c, '/' | ':' | '\\') {
                ' '
            } else {
                c
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let cut: String = cleaned.chars().take(NAME_MOST).collect();
    let safe = names::safe_local_name(cut.trim());
    let safe = safe.trim().trim_start_matches('.').trim().to_string();
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe
    }
}

fn plan_folder(
    db: &Store,
    drive: &Drive,
    conversation: &str,
    place: &Place,
) -> Result<String, String> {
    let space = SpaceId(place.space.clone());
    let agent = safe_name(&place.agent, "Agent");
    let title = safe_name(&place.title, "Thread");
    for attempt in 1..1000 {
        let name = if attempt == 1 {
            title.clone()
        } else {
            format!("{title} {attempt}")
        };
        let folder = names::drive_path(&format!("{AGENTS}/{agent}/{name}"))?;
        if folder_taken(db, &place.space, &folder, conversation)? {
            continue;
        }
        if drive
            .node_at(&space, &folder)
            .map_err(crate::spaces_drive::error_text)?
            .is_some()
        {
            continue;
        }
        return Ok(folder);
    }
    Err("Misty couldn't name this thread's folder.".into())
}

pub(crate) fn cwd(db: &Store, conversation: &str, folder: &str) -> Result<PathBuf, String> {
    Ok(local_of(&workspace(db, conversation)?, folder))
}

pub(crate) fn current(db: &Store, account: &str, conversation: &str) -> Option<PathBuf> {
    let row = load(db, account, conversation).ok()??;
    cwd(db, conversation, &row.folder)
        .ok()
        .filter(|folder| file_access::fs::is_dir(folder))
}

pub(crate) fn read_snapshot(db: &Store, conversation: &str) -> Result<Snapshot, String> {
    let path = meta(db, conversation, ".json")?;
    match file_access::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(text),
        Err(_) => Ok(Snapshot::default()),
    }
}

pub(crate) fn write_snapshot(
    db: &Store,
    conversation: &str,
    snapshot: &Snapshot,
) -> Result<(), String> {
    let path = meta(db, conversation, ".json")?;
    write_json(&path, snapshot)
}

pub(crate) fn read_known(db: &Store, conversation: &str) -> BTreeMap<String, String> {
    meta(db, conversation, ".known.json")
        .ok()
        .and_then(|path| file_access::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn write_known(
    db: &Store,
    conversation: &str,
    known: &BTreeMap<String, String>,
) -> Result<(), String> {
    write_json(&meta(db, conversation, ".known.json")?, known)
}

pub(crate) fn start_copy(db: &Store, conversation: &str) -> Result<PathBuf, String> {
    meta(db, conversation, ".start")
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        file_access::fs::create_dir_all(parent).map_err(text)?;
    }
    let bytes = serde_json::to_vec(value).map_err(text)?;
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
    file_access::fs::write(&temp, bytes).map_err(text)?;
    file_access::fs::rename(&temp, path).map_err(text)
}

pub(crate) fn clear_meta(db: &Store, conversation: &str) {
    if let Ok(path) = meta(db, conversation, ".json") {
        let _ = file_access::fs::remove_file(path);
    }
    if let Ok(path) = start_copy(db, conversation) {
        let _ = file_access::fs::remove_dir_all(path);
    }
}

pub(crate) fn view(conversation: &str, row: &Row) -> ThreadView {
    ThreadView {
        conversation_id: conversation.to_string(),
        space_id: row.space.clone(),
        folder: row.folder.clone(),
        state: row.state.clone(),
        clashes: row.clashes.clone(),
        note: row.note.clone(),
    }
}

pub(crate) fn tell(app: &AppHandle, conversation: &str, row: &Row) {
    let payload = view(conversation, row);
    for window in crate::browser::app_windows::person_windows(app) {
        let _ = app.emit_to(window.label(), EVENT, payload.clone());
    }
}

pub(crate) fn caught_up(drive: &Drive, space: &SpaceId) -> bool {
    drive.status(space).is_some_and(|status| {
        matches!(status.status, StatusKind::Idle) && status.pending_downloads == 0
    })
}

static SPACE_LOCKS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(Default::default);

pub(crate) fn space_lock(space: &str) -> Arc<tokio::sync::Mutex<()>> {
    SPACE_LOCKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .entry(space.to_string())
        .or_default()
        .clone()
}

pub(crate) fn note(workspace: &Path, cwd: &Path, mount: &Path, folder: &str) -> String {
    format!(
        "# Where you work\nThis thread's folder is {cwd}: your own copy of {folder} in the Space. \
         Everything you save under {workspace} lands in the Space at the same path when your turn \
         ends, merged with anyone else's changes, so save your work in this folder. The rest of \
         the Space is at {mount}: read anything there. To change a file elsewhere in the Space, \
         copy it from {mount} to the same path under {workspace} and edit the copy there. Never \
         write into {mount} directly.",
        cwd = cwd.display(),
        workspace = workspace.display(),
        mount = mount.display(),
    )
}

async fn pull(
    drive: &Drive,
    space: &SpaceId,
    folder: &str,
    root: &Path,
    known: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    let files: Vec<(String, String)> = drive
        .file_shas(space)
        .map_err(crate::spaces_drive::error_text)?
        .into_iter()
        .filter(|(path, _)| names::is_within(path, folder) && path != folder)
        .collect();
    let mut agreed = BTreeMap::new();
    for (path, sha) in &files {
        let local = local_of(root, path);
        let ours = sha_of(&local);
        if ours.as_deref() == Some(sha.as_str()) {
            agreed.insert(path.clone(), sha.clone());
            continue;
        }
        if ours != known.get(path).cloned() {
            if let Some(kept) = known.get(path) {
                agreed.insert(path.clone(), kept.clone());
            }
            continue;
        }
        let Ok(bytes) = drive.read_capped(space, path, PULL_MOST).await else {
            continue;
        };
        if let Some(parent) = local.parent() {
            file_access::fs::create_dir_all(parent).map_err(text)?;
        }
        file_access::fs::write(&local, bytes).map_err(text)?;
        agreed.insert(path.clone(), sha.clone());
    }
    for (path, kept) in known {
        if files.iter().any(|(listed, _)| listed == path) {
            continue;
        }
        let local = local_of(root, path);
        if sha_of(&local).as_deref() == Some(kept.as_str()) {
            let _ = file_access::fs::remove_file(&local);
        }
    }
    Ok(agreed)
}

pub(crate) struct Opened {
    pub cwd: PathBuf,
    pub workspace: PathBuf,
    pub note: String,
}

pub(crate) async fn open(
    app: &AppHandle,
    db: &Store,
    account: &str,
    conversation: &str,
    place: &Place,
) -> Result<Option<Opened>, String> {
    if conversation.is_empty() {
        return Ok(None);
    }
    let Some(mount) = crate::spaces_drive::run_folder(&place.space) else {
        return Ok(None);
    };
    let Ok(drive) = crate::spaces_drive::drive() else {
        return Ok(None);
    };
    let row = {
        let (db, account, conversation, place, drive) = (
            db.clone(),
            account.to_string(),
            conversation.to_string(),
            place.clone(),
            drive.clone(),
        );
        blocking(move || match load(&db, &account, &conversation)? {
            Some(row) => Ok(row),
            None => {
                let row = Row {
                    space: place.space.clone(),
                    agent_id: place.agent_id.clone(),
                    folder: plan_folder(&db, &drive, &conversation, &place)?,
                    state: "idle".into(),
                    started: false,
                    clashes: Vec::new(),
                    note: String::new(),
                };
                save(&db, &account, &conversation, &row)?;
                let _ = drive.make_folders(&SpaceId(row.space.clone()), &row.folder);
                Ok(row)
            }
        })
        .await?
    };
    let mount = crate::spaces_drive::run_folder(&row.space).unwrap_or(mount);
    let root = workspace(db, conversation)?;
    let cwd = local_of(&root, &row.folder);
    file_access::fs::create_dir_all(&cwd).map_err(text)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file_access::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700));
    }
    begin(app, db, &drive, account, conversation, row.clone(), &root).await?;
    Ok(Some(Opened {
        note: note(&root, &cwd, &mount, &row.folder),
        cwd,
        workspace: root,
    }))
}

async fn begin(
    app: &AppHandle,
    db: &Store,
    drive: &Drive,
    account: &str,
    conversation: &str,
    mut row: Row,
    root: &Path,
) -> Result<(), String> {
    let lock = space_lock(&row.space);
    let _turn = lock.lock().await;
    if !row.started {
        let space = SpaceId(row.space.clone());
        let known = read_known(db, conversation);
        let agreed = pull(drive, &space, &row.folder, root, &known).await?;
        write_known(db, conversation, &agreed)?;
        let space_files: BTreeMap<String, String> = drive
            .file_shas(&space)
            .map_err(crate::spaces_drive::error_text)?
            .into_iter()
            .collect();
        let walked = {
            let root = root.to_path_buf();
            blocking(move || Ok(walk(&root))).await?
        };
        let start = start_copy(db, conversation)?;
        let _ = file_access::fs::remove_dir_all(&start);
        let thread_folder = local_of(root, &row.folder);
        if file_access::fs::is_dir(&thread_folder) {
            let copy_to = local_of(&start, &row.folder);
            if let Some(parent) = copy_to.parent() {
                file_access::fs::create_dir_all(parent).map_err(text)?;
            }
            let _ = file_access::fs::copy_tree(&thread_folder, &copy_to);
        }
        write_snapshot(
            db,
            conversation,
            &Snapshot {
                space: space_files,
                work: walked,
            },
        )?;
        row.started = true;
    }
    row.state = "working".into();
    save(db, account, conversation, &row)?;
    tell(app, conversation, &row);
    Ok(())
}

pub(crate) fn after_run(app: &AppHandle, account: String, conversation: String) {
    if conversation.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let db = app.state::<MistyRuntime>().environment.store();
        let found = {
            let (db, account, conversation) = (db.clone(), account.clone(), conversation.clone());
            blocking(move || load(&db, &account, &conversation)).await
        };
        let Ok(Some(row)) = found else {
            return;
        };
        if !row.started || row.state == "clashed" {
            return;
        }
        if let Err(error) = land(&app, &db, &account, &conversation, true).await {
            eprintln!("[threads] landing a turn failed: {error}");
        }
    });
}

pub(crate) fn drive_settled(app: &AppHandle, space: &str) {
    let app = app.clone();
    let space = space.to_string();
    tauri::async_runtime::spawn(async move {
        let db = app.state::<MistyRuntime>().environment.store();
        let held = {
            let (db, space) = (db.clone(), space.clone());
            blocking(move || {
                let connection = db.connect().map_err(text)?;
                let mut statement = connection
                    .prepare(
                        "SELECT account, conversation_id FROM thread_work
                         WHERE space_id = ?1 AND state = 'held' AND note = ''",
                    )
                    .map_err(text)?;
                let rows = statement
                    .query_map([space], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(text)?;
                rows.collect::<Result<Vec<_>, _>>().map_err(text)
            })
            .await
        };
        for (account, conversation) in held.unwrap_or_default() {
            if let Err(error) = land(&app, &db, &account, &conversation, false).await {
                eprintln!("[threads] landing a held turn failed: {error}");
            }
        }
    });
}

pub(crate) fn forget(db: &Store, account: &str, conversation: &str) -> Result<(), String> {
    let connection = db.connect().map_err(text)?;
    for statement in [
        "DELETE FROM thread_work WHERE account = ?1 AND conversation_id = ?2",
        "DELETE FROM thread_outputs WHERE account = ?1 AND conversation_id = ?2",
    ] {
        connection
            .execute(statement, [account, conversation])
            .map_err(text)?;
    }
    clear_meta(db, conversation);
    if let Ok(path) = meta(db, conversation, ".known.json") {
        let _ = file_access::fs::remove_file(path);
    }
    if let Ok(path) = workspace(db, conversation) {
        if file_access::fs::is_dir(&path) {
            file_access::fs::remove_dir_all(&path).map_err(text)?;
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadOutput {
    path: String,
    local: String,
    space_id: String,
    landed_at: i64,
}

#[tauri::command]
pub async fn thread_work_status(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<Option<ThreadView>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || Ok(load(&db, &account, &conversation)?.map(|row| view(&conversation, &row))))
        .await
}

#[tauri::command]
pub async fn thread_outputs(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<Vec<ThreadOutput>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        let Some(row) = load(&db, &account, &conversation)? else {
            return Ok(Vec::new());
        };
        let mount = crate::spaces_drive::run_folder(&row.space);
        let connection = db.connect().map_err(text)?;
        let mut statement = connection
            .prepare(
                "SELECT path, landed_at FROM thread_outputs
                 WHERE account = ?1 AND conversation_id = ?2 ORDER BY landed_at DESC, path",
            )
            .map_err(text)?;
        let rows = statement
            .query_map([&account, &conversation], |found| {
                let path: String = found.get(0)?;
                Ok(ThreadOutput {
                    local: mount
                        .as_ref()
                        .map(|mount| local_of(mount, &path).to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    path,
                    space_id: row.space.clone(),
                    landed_at: found.get(1)?,
                })
            })
            .map_err(text)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(text)
    })
    .await
}

#[tauri::command]
pub async fn thread_work_land(
    app: AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<Option<ThreadView>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    land(&app, &db, &account, &conversation, false).await
}

#[tauri::command]
pub async fn thread_work_resolve(
    app: AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    path: Option<String>,
    choice: String,
) -> Result<Option<ThreadView>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    land::resolve(&app, &db, &account, &conversation, path.as_deref(), &choice).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadClashes {
    conversation_id: String,
    agent_id: String,
    space_id: String,
    folder: String,
    clashes: Vec<Clash>,
}

#[tauri::command]
pub async fn thread_clashes(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
) -> Result<Vec<ThreadClashes>, String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || {
        let connection = db.connect().map_err(text)?;
        let mut statement = connection
            .prepare(
                "SELECT conversation_id, agent_id, space_id, folder, clashes FROM thread_work
                 WHERE account = ?1 AND state = 'clashed' ORDER BY updated_at DESC",
            )
            .map_err(text)?;
        let rows = statement
            .query_map([&account], |row| {
                Ok(ThreadClashes {
                    conversation_id: row.get(0)?,
                    agent_id: row.get(1)?,
                    space_id: row.get(2)?,
                    folder: row.get(3)?,
                    clashes: clashes_of(&row.get::<_, String>(4)?),
                })
            })
            .map_err(text)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(text)
    })
    .await
}
