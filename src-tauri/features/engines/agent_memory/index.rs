use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::Duration;

use database::store::Store;
use serde_json::Value;
use space_drive::{DriveEntry, DriveError, Kind, SpaceId};
use tauri::{AppHandle, Listener, Manager};

use super::topics::{self, INDEX};
use crate::engines::recall::MemoryNote;

const MOST_INDEXED_BYTES: u64 = 256 * 1024;
const MOST_FILES: usize = 500;
const READ_WAIT: Duration = Duration::from_secs(20);
const FRESH_WAIT: Duration = Duration::from_secs(4);
const SETTLE: Duration = Duration::from_millis(400);
pub(crate) const SOURCE: &str = "Space memory";
pub(crate) const NOTE_PREFIX: &str = "space:";

static REFRESHING: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
static WAITING: LazyLock<Mutex<HashSet<(String, String)>>> = LazyLock::new(Default::default);
static LISTENING: OnceLock<()> = OnceLock::new();

pub(crate) fn folder_of(agent: &str) -> String {
    format!("/.agents/{agent}/memory")
}

fn store_of(app: &AppHandle) -> Store {
    app.state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store()
}

fn agent_in(path: &str) -> Option<String> {
    let mut parts = path.split('/').filter(|part| !part.is_empty());
    if parts.next()? != ".agents" {
        return None;
    }
    let agent = parts.next()?;
    match parts.next() {
        None | Some("memory") => Some(agent.to_string()),
        Some(_) => None,
    }
}

fn changed_folders(payload: &Value) -> Vec<(String, String)> {
    let Some(space) = payload["space_id"].as_str().filter(|id| !id.is_empty()) else {
        return Vec::new();
    };
    let mut found: Vec<(String, String)> = Vec::new();
    for item in payload["items"].as_array().into_iter().flatten() {
        let Some(agent) = item["path"].as_str().and_then(agent_in) else {
            continue;
        };
        let key = (space.to_string(), agent);
        if !found.contains(&key) {
            found.push(key);
        }
    }
    found
}

pub(crate) fn listen(app: &AppHandle) {
    LISTENING.get_or_init(|| {
        let heard = app.clone();
        app.listen_any(crate::spaces_drive::CHANGED_EVENT, move |event| {
            let Ok(payload) = serde_json::from_str::<Value>(event.payload()) else {
                return;
            };
            for (space, agent) in changed_folders(&payload) {
                refresh_soon(&heard, &space, &agent);
            }
        });
    });
}

pub(crate) fn drive_changed<'a>(
    app: &AppHandle,
    space: &str,
    paths: impl IntoIterator<Item = &'a str>,
) {
    let mut agents: Vec<String> = Vec::new();
    for path in paths {
        if let Some(agent) = agent_in(path) {
            if !agents.contains(&agent) {
                agents.push(agent);
            }
        }
    }
    for agent in agents {
        refresh_soon(app, space, &agent);
    }
}

pub(crate) fn refresh_soon(app: &AppHandle, space: &str, agent: &str) {
    let key = (space.to_string(), agent.to_string());
    let fresh = WAITING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(key.clone());
    if !fresh {
        return;
    }
    let store = store_of(app);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        WAITING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&key);
        if let Err(error) = refresh(&store, &key.0, &key.1).await {
            eprintln!("[memory] couldn't index an agent's memory: {error}");
        }
    });
}

pub(crate) async fn fresh(store: &Store, space: &str, agent: &str) {
    let _ = tokio::time::timeout(FRESH_WAIT, refresh(store, space, agent)).await;
}

fn stamp_of(entry: &DriveEntry) -> String {
    format!(
        "{}:{}:{}",
        entry.version.map(|version| version.0).unwrap_or(0),
        entry.mtime_ms,
        entry.size
    )
}

fn topic_entries(space: &SpaceId, agent: &str) -> Result<Vec<DriveEntry>, String> {
    let drive = crate::spaces_drive::drive()?;
    let page = match drive.entries(space, &folder_of(agent), None, Some(MOST_FILES)) {
        Ok(page) => page.entries,
        Err(DriveError::NotFound) => Vec::new(),
        Err(error) => return Err(crate::spaces_drive::error_text(error)),
    };
    Ok(page
        .into_iter()
        .filter(|entry| entry.kind == Kind::File && topics::good_file(&entry.name))
        .collect())
}

fn known_stamps(
    store: &Store,
    space: &str,
    agent: &str,
) -> Result<HashMap<String, String>, String> {
    let connection = store.connect().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT file, stamp FROM agent_memory_recall WHERE space_id = ?1 AND agent_id = ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(rusqlite::params![space, agent], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    Ok(rows.flatten().collect())
}

struct Indexed {
    file: String,
    title: String,
    text: String,
    stamp: String,
}

fn save(
    store: &Store,
    space: &str,
    agent: &str,
    gone: &[String],
    read: &[Indexed],
) -> Result<(), String> {
    let mut connection = store.connect().map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for file in gone.iter().chain(read.iter().map(|topic| &topic.file)) {
        transaction
            .execute(
                "DELETE FROM agent_memory_recall WHERE space_id = ?1 AND agent_id = ?2 AND file = ?3",
                rusqlite::params![space, agent, file],
            )
            .map_err(|error| error.to_string())?;
    }
    for topic in read {
        transaction
            .execute(
                "INSERT INTO agent_memory_recall (text, title, space_id, agent_id, file, stamp)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    topic.text,
                    topic.title,
                    space,
                    agent,
                    topic.file,
                    topic.stamp
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub(crate) async fn refresh(store: &Store, space: &str, agent: &str) -> Result<(), String> {
    let _held = REFRESHING.lock().await;
    let space_id = SpaceId(space.to_string());
    let entries = topic_entries(&space_id, agent)?;
    let known = {
        let (store, space, agent) = (store.clone(), space.to_string(), agent.to_string());
        tokio::task::spawn_blocking(move || known_stamps(&store, &space, &agent))
            .await
            .map_err(|error| error.to_string())??
    };
    let drive = crate::spaces_drive::drive()?;
    let mut read = Vec::new();
    for entry in &entries {
        let stamp = stamp_of(entry);
        if known.get(&entry.name) == Some(&stamp) || entry.size > MOST_INDEXED_BYTES {
            continue;
        }
        let reading = drive.read_capped(&space_id, &entry.path, MOST_INDEXED_BYTES);
        let bytes = tokio::time::timeout(READ_WAIT, reading).await;
        let Ok(Ok(bytes)) = bytes else {
            continue;
        };
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        let topic = topics::split(&text);
        read.push(Indexed {
            title: topics::title_of(&topic.front, &entry.name),
            file: entry.name.clone(),
            text,
            stamp,
        });
    }
    let listed: HashSet<&str> = entries
        .iter()
        .filter(|entry| entry.size <= MOST_INDEXED_BYTES)
        .map(|entry| entry.name.as_str())
        .collect();
    let gone: Vec<String> = known
        .keys()
        .filter(|file| !listed.contains(file.as_str()))
        .cloned()
        .collect();
    if read.is_empty() && gone.is_empty() {
        return Ok(());
    }
    let (store, space, agent) = (store.clone(), space.to_string(), agent.to_string());
    tokio::task::spawn_blocking(move || save(&store, &space, &agent, &gone, &read))
        .await
        .map_err(|error| error.to_string())?
}

pub(crate) fn notes(store: &Store, space: &str, agent: &str) -> Result<Vec<MemoryNote>, String> {
    let connection = store.connect().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT file, title, text FROM agent_memory_recall
             WHERE space_id = ?1 AND agent_id = ?2",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(rusqlite::params![space, agent], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut notes: Vec<MemoryNote> = rows
        .flatten()
        .filter(|(file, _, _)| file != INDEX)
        .map(|(file, title, text)| MemoryNote {
            id: format!("{NOTE_PREFIX}{file}"),
            title,
            source: SOURCE.into(),
            content: text,
            deletable: true,
        })
        .collect();
    notes.sort_by_key(|note| note.title.to_lowercase());
    Ok(notes)
}

pub(crate) struct Hit {
    pub(crate) title: String,
    pub(crate) text: String,
}

pub(crate) fn matching(
    store: &Store,
    space: &str,
    agent: &str,
    matched: &str,
    query: &str,
    most: usize,
) -> Result<Vec<Hit>, String> {
    let connection = store.connect().map_err(|error| error.to_string())?;
    let (sql, term) = if matched.is_empty() {
        (
            "SELECT title, text FROM agent_memory_recall
             WHERE space_id = ?1 AND agent_id = ?2 AND text LIKE ?3 LIMIT ?4",
            format!("%{}%", query.trim()),
        )
    } else {
        (
            "SELECT title, text FROM agent_memory_recall
             WHERE agent_memory_recall MATCH ?3 AND space_id = ?1 AND agent_id = ?2
             ORDER BY rank LIMIT ?4",
            matched.to_string(),
        )
    };
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(rusqlite::params![space, agent, term, most as i64], |row| {
            Ok(Hit {
                title: row.get(0)?,
                text: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?;
    Ok(rows.flatten().collect())
}
