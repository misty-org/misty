//! Agent trash: where an agent's `files.trash` puts what it cleans up, instead of deleting it or
//! using the system Trash, after Kura's own trash folder and put-back ledger.
//! Each item waits in a holding folder Misty owns (`agent_trash_moves.rs`), with a row in
//! `files_agent_trash` saying where it came from, which agent and chat moved it, and when. An item
//! in a mounted Space drive goes to that Space's own trash instead, held there so it never empties
//! itself; the drive writes its row (no holding path) once the server has it.
//!
//! It never empties itself. Only the person's window lists it, puts items back and deletes them:
//! every command here checks that, and no tool or SDK call reaches them.
use std::path::{Path, PathBuf};

use file_access::disk::fs_disk;
use serde::{Deserialize, Serialize};
use space_drive::{ItemId, SpaceId, TrashBy};
use tauri::{AppHandle, Manager, Webview};

use super::{blocking, display_name, entry::FileKind, person_window};

#[path = "agent_trash_moves.rs"]
mod moves;

#[cfg(test)]
pub(crate) use moves::misty_holding;

/// One item in Agent trash (`AgentTrashItem` in `disk.ts`).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTrashItem {
    pub id: i64,
    pub name: String,
    pub original_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holding_path: Option<String>,
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_id: Option<String>,
    pub trashed_at: i64,
    pub size: u64,
    pub kind: FileKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drive_item_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTrashUsage {
    pub bytes: u64,
    pub items: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oldest_ms: Option<i64>,
}

/// What Put back does when something is already at the item's old place (`Resolution`).
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum PutBackChoice {
    /// The one there now goes to the system Trash, where Put Back can return it.
    Replace,
    /// The item comes back beside it, as "name 2".
    KeepBoth,
    Skip,
}

/// `Failure` in `disk.ts`: an item, by its name or path, and why it didn't go.
#[derive(Clone, Debug, Serialize)]
pub struct HeldFailure {
    pub path: String,
    pub error: String,
}

/// `TransferResult` in `disk.ts`.
#[derive(Clone, Debug, Default, Serialize)]
pub struct PutBackResult {
    pub created: Vec<String>,
    pub failed: Vec<HeldFailure>,
    pub cancelled: bool,
}

/// A row of `files_agent_trash`.
#[derive(Clone, Debug)]
struct Row {
    id: i64,
    original: String,
    holding: Option<String>,
    agent: String,
    chat: Option<String>,
    at: i64,
    space: Option<String>,
    item: Option<String>,
}

impl Row {
    /// The Space's trash keeps it, not a holding folder.
    fn in_drive(&self) -> Option<(SpaceId, ItemId)> {
        match (&self.space, &self.item) {
            (Some(space), Some(item)) if ItemId::is_valid(item) => {
                Some((SpaceId(space.clone()), ItemId(item.clone())))
            }
            _ => None,
        }
    }
}

fn connect(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    app.state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store()
        .connect()
        .map_err(|error| error.to_string())
}

/// Every row, newest first, or only those `ids` names.
fn rows(app: &AppHandle, ids: Option<&[i64]>) -> Result<Vec<Row>, String> {
    let connection = connect(app)?;
    let mut statement = connection
        .prepare(
            "SELECT id, original_path, holding_path, agent_id, chat_id, trashed_at, space_id,
                    drive_item_id
             FROM files_agent_trash ORDER BY trashed_at DESC, id DESC",
        )
        .map_err(|error| error.to_string())?;
    let found = statement
        .query_map([], |row| {
            Ok(Row {
                id: row.get(0)?,
                original: row.get(1)?,
                holding: row.get(2)?,
                agent: row.get(3)?,
                chat: row.get(4)?,
                at: row.get(5)?,
                space: row.get(6)?,
                item: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?
        .flatten()
        .filter(|row| ids.is_none_or(|ids| ids.contains(&row.id)))
        .collect();
    Ok(found)
}

fn forget_row(app: &AppHandle, id: i64) -> Result<(), String> {
    connect(app)?
        .execute("DELETE FROM files_agent_trash WHERE id = ?1", [id])
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// The Space and drive path of an item inside a mounted Space drive.
fn drive_item(path: &Path) -> Option<(SpaceId, String)> {
    if !file_access::is_in_space_drive(path) {
        return None;
    }
    for status in crate::spaces_drive::all_statuses() {
        let Some(mount) = crate::spaces_drive::run_folder(&status.space_id.0) else {
            continue;
        };
        let real_mount = file_access::fs::canonicalize(&mount).unwrap_or_else(|_| mount.clone());
        let real_path = file_access::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let inside = path
            .strip_prefix(&mount)
            .or_else(|_| real_path.strip_prefix(&real_mount));
        if let Ok(inside) = inside {
            return space_drive::names::path_from_components(inside)
                .ok()
                .map(|drive_path| (status.space_id.clone(), drive_path));
        }
    }
    None
}

/// Moves an item an agent trashed into Agent trash and answers its row's id. The path has passed
/// `agent_paths::admit` for writing already. An item in a Space drive goes to that Space's trash,
/// held for the person; its row comes from the drive once the server takes it, so the answer then
/// is 0.
pub fn move_to_agent_trash(
    app: &AppHandle,
    path: &Path,
    agent_id: &str,
    chat_id: Option<&str>,
) -> Result<i64, String> {
    if let Some((space, drive_path)) = drive_item(path) {
        let drive = crate::spaces_drive::drive()?;
        let node = drive
            .node_at(&space, &drive_path)
            .map_err(crate::spaces_drive::error_text)?
            .ok_or_else(|| format!("{} isn't there any more.", display_name(path)))?;
        let by = TrashBy::Agent {
            agent_id: agent_id.to_owned(),
            chat_id: chat_id.unwrap_or("").to_owned(),
        };
        drive
            .trash(&space, &node.id, by)
            .map_err(crate::spaces_drive::error_text)?;
        return Ok(0);
    }
    let holding = moves::into_holding(path)?;
    let saved = connect(app).and_then(|connection| {
        connection
            .execute(
                "INSERT INTO files_agent_trash (original_path, holding_path, agent_id, chat_id,
                    trashed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    path.to_string_lossy().into_owned(),
                    holding.to_string_lossy().into_owned(),
                    agent_id,
                    chat_id.filter(|chat| !chat.is_empty()),
                    chrono::Utc::now().timestamp_millis(),
                ],
            )
            .map(|_| connection.last_insert_rowid())
            .map_err(|error| error.to_string())
    });
    match saved {
        Ok(id) => Ok(id),
        Err(error) => {
            // Never held without a record of where it came from.
            let _ = moves::out_of_holding(&holding, path);
            Err(format!("Misty couldn't record {} in Agent trash: {error}", display_name(path)))
        }
    }
}

fn item_of(row: &Row) -> AgentTrashItem {
    let (kind, size) = match &row.holding {
        Some(holding) => moves::held_size(Path::new(holding)),
        None => (FileKind::File, 0),
    };
    AgentTrashItem {
        id: row.id,
        name: display_name(Path::new(&row.original)),
        original_path: row.original.clone(),
        holding_path: row.holding.clone(),
        agent_id: row.agent.clone(),
        chat_id: row.chat.clone(),
        trashed_at: row.at,
        size,
        kind,
        space_id: row.space.clone(),
        drive_item_id: row.item.clone(),
    }
}

#[tauri::command]
pub async fn files_agent_trash_list(
    app: AppHandle,
    webview: Webview,
) -> Result<Vec<AgentTrashItem>, String> {
    person_window(&webview)?;
    blocking(move || Ok(rows(&app, None)?.iter().map(item_of).collect())).await
}

#[tauri::command]
pub async fn files_agent_trash_usage(
    app: AppHandle,
    webview: Webview,
) -> Result<AgentTrashUsage, String> {
    person_window(&webview)?;
    blocking(move || {
        let rows = rows(&app, None)?;
        Ok(AgentTrashUsage {
            bytes: rows.iter().map(|row| item_of(row).size).sum(),
            items: rows.len() as u64,
            oldest_ms: rows.iter().map(|row| row.at).min(),
        })
    })
    .await
}

/// Puts one held item back where it was. `None` when it was skipped.
fn put_back_local(app: &AppHandle, row: &Row, choice: PutBackChoice) -> Result<Option<String>, String> {
    let holding = PathBuf::from(row.holding.as_deref().ok_or("That item isn't in Agent trash.")?);
    let original = super::asked_path(&row.original)?;
    let name = display_name(&original);
    let mut target = original.clone();
    if fs_disk::exists(&target) {
        match choice {
            PutBackChoice::Skip => return Ok(None),
            PutBackChoice::KeepBoth => {
                let folder = original.parent().ok_or("That item has no folder to go back to.")?;
                target = super::transfer::keep_both_name(folder, &name);
            }
            PutBackChoice::Replace => {
                let (_, failures) = super::trash::trash_paths(&[target.clone()]);
                if !failures.is_empty() {
                    return Err(format!(
                        "{name} wasn't put back: the one there now couldn't go to the Trash."
                    ));
                }
            }
        }
    }
    moves::out_of_holding(&holding, &target)?;
    forget_row(app, row.id)?;
    Ok(Some(target.display().to_string()))
}

#[tauri::command]
pub async fn files_agent_trash_put_back(
    app: AppHandle,
    webview: Webview,
    ids: Vec<i64>,
    resolution: PutBackChoice,
) -> Result<PutBackResult, String> {
    person_window(&webview)?;
    let found = {
        let app = app.clone();
        blocking(move || rows(&app, Some(&ids))).await?
    };
    let mut result = PutBackResult::default();
    for row in found {
        let done = match row.in_drive() {
            Some((space, item)) => restore_in_drive(&app, &space, &item).await.map(|()| {
                Some(row.original.clone())
            }),
            None => {
                let (app, row) = (app.clone(), row.clone());
                blocking(move || put_back_local(&app, &row, resolution)).await
            }
        };
        match done {
            Ok(Some(path)) => result.created.push(path),
            Ok(None) => {}
            Err(error) => result.failed.push(HeldFailure {
                path: row.original.clone(),
                error,
            }),
        }
    }
    Ok(result)
}

async fn restore_in_drive(app: &AppHandle, space: &SpaceId, item: &ItemId) -> Result<(), String> {
    crate::spaces_drive::drive()?
        .restore(space, item)
        .await
        .map_err(crate::spaces_drive::error_text)?;
    crate::spaces_drive::forget_agent_trash(app, &space.0, &item.0);
    Ok(())
}

/// Deletes held items for good, after the person's confirm in `ConfirmDeleteDialog`.
async fn delete_rows(app: &AppHandle, found: Vec<Row>) -> Vec<HeldFailure> {
    let mut failed = Vec::new();
    for row in found {
        let done = match row.in_drive() {
            Some((space, item)) => match crate::spaces_drive::drive() {
                Ok(drive) => drive
                    .purge(&space, &item)
                    .await
                    .map_err(crate::spaces_drive::error_text)
                    .map(|()| crate::spaces_drive::forget_agent_trash(app, &space.0, &item.0)),
                Err(error) => Err(error),
            },
            None => {
                let (app, row) = (app.clone(), row.clone());
                blocking(move || {
                    if let Some(holding) = &row.holding {
                        moves::remove_held(Path::new(holding))
                            .map_err(|error| super::failed(Path::new(&row.original), error))?;
                    }
                    forget_row(&app, row.id)
                })
                .await
            }
        };
        if let Err(error) = done {
            failed.push(HeldFailure {
                path: row.original.clone(),
                error,
            });
        }
    }
    failed
}

#[tauri::command]
pub async fn files_agent_trash_delete(
    app: AppHandle,
    webview: Webview,
    ids: Vec<i64>,
) -> Result<Vec<HeldFailure>, String> {
    person_window(&webview)?;
    let found = {
        let app = app.clone();
        blocking(move || rows(&app, Some(&ids))).await?
    };
    Ok(delete_rows(&app, found).await)
}

#[tauri::command]
pub async fn files_agent_trash_empty(
    app: AppHandle,
    webview: Webview,
) -> Result<Vec<HeldFailure>, String> {
    person_window(&webview)?;
    let found = {
        let app = app.clone();
        blocking(move || rows(&app, None)).await?
    };
    Ok(delete_rows(&app, found).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_back_choices_read_as_disk_ts_writes_them() {
        let read = |text: &str| serde_json::from_str::<PutBackChoice>(text).unwrap();
        assert_eq!(read("\"replace\""), PutBackChoice::Replace);
        assert_eq!(read("\"keep-both\""), PutBackChoice::KeepBoth);
        assert_eq!(read("\"skip\""), PutBackChoice::Skip);
    }

    #[test]
    fn the_holding_folder_is_misty_s_own_never_the_system_trash() {
        let root = file_access::paths::misty_root_dir().expect("a data folder");
        assert_eq!(misty_holding(), Some(root.join("agent-trash")));
    }

    #[test]
    fn a_drive_row_is_told_apart_by_its_item() {
        let row = |item: Option<&str>| Row {
            id: 1,
            original: "/a".into(),
            holding: None,
            agent: "a".into(),
            chat: None,
            at: 0,
            space: Some("s".into()),
            item: item.map(str::to_owned),
        };
        assert!(row(None).in_drive().is_none());
        assert!(row(Some("drv_nope")).in_drive().is_none());
        let id = format!("drv_{}", uuid::Uuid::new_v4());
        assert!(row(Some(&id)).in_drive().is_some());
    }
}
