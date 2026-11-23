use space_drive::{DriveEntry, ItemId, Kind, NewNode, SpaceId};
use tauri::Webview;

use super::{drive, error_text};
use crate::project::person_window;

fn space_of(space_id: &str) -> Result<SpaceId, String> {
    if space_id.is_empty() || space_id.len() > 128 {
        return Err("That isn't a Space.".into());
    }
    Ok(SpaceId(space_id.to_owned()))
}

fn node_id(space: &SpaceId, path: &str) -> Result<ItemId, String> {
    drive()?
        .node_at(space, path)
        .map_err(error_text)?
        .map(|node| node.id)
        .ok_or_else(|| "It isn't there any more.".to_string())
}

fn folder_id(space: &SpaceId, path: &str) -> Result<Option<ItemId>, String> {
    if path.trim_matches('/').is_empty() {
        return Ok(None);
    }
    let node = drive()?
        .node_at(space, path)
        .map_err(error_text)?
        .ok_or_else(|| "That folder isn't there any more.".to_string())?;
    if node.kind != Kind::Folder {
        return Err(format!("{} isn't a folder.", node.name));
    }
    Ok(Some(node.id))
}

fn valid_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("That name can't be used.".into());
    }
    Ok(name)
}

fn placed_error(error: space_drive::DriveError, name: &str) -> String {
    match error {
        space_drive::DriveError::Exists => format!("exists:{name}"),
        other => error_text(other),
    }
}

fn entry_of(space: &SpaceId, id: &ItemId) -> Result<DriveEntry, String> {
    drive()?
        .entry_by_id(space, id)
        .map_err(error_text)?
        .ok_or_else(|| "It isn't there any more.".to_string())
}

#[tauri::command]
pub async fn drive_create_folder(
    webview: Webview,
    space_id: String,
    folder: String,
    name: String,
) -> Result<DriveEntry, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let new = NewNode {
        parent: folder_id(&space, &folder)?,
        name: valid_name(&name)?.to_owned(),
        kind: Kind::Folder,
        content: None,
        mtime_ms: chrono::Utc::now().timestamp_millis(),
        id: None,
    };
    let node = drive()?.create(&space, new).map_err(error_text)?;
    entry_of(&space, &node.id)
}

#[tauri::command]
pub async fn drive_rename(
    webview: Webview,
    space_id: String,
    path: String,
    name: String,
    replace: Option<bool>,
) -> Result<DriveEntry, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let drive = drive()?;
    let node = drive
        .node_at(&space, &path)
        .map_err(error_text)?
        .ok_or_else(|| "It isn't there any more.".to_string())?;
    let name = valid_name(&name)?;
    let renamed = drive
        .rename_checked(
            &space,
            &node.id,
            node.parent.as_ref(),
            name,
            replace.unwrap_or(false),
        )
        .map_err(|error| placed_error(error, name))?;
    entry_of(&space, &renamed.id)
}

#[tauri::command]
pub async fn drive_move(
    webview: Webview,
    space_id: String,
    paths: Vec<String>,
    folder: String,
    replace: Option<bool>,
) -> Result<Vec<DriveEntry>, String> {
    person_window(&webview)?;
    let space = space_of(&space_id)?;
    let target = folder_id(&space, &folder)?;
    let folder_path = folder.trim_end_matches('/').to_owned();
    let drive = drive()?;
    let (mut moved, mut refused) = (Vec::new(), None);
    let mut taken: Option<String> = None;
    for path in &paths {
        let inside = folder_path == path.trim_end_matches('/')
            || folder_path.starts_with(&format!("{}/", path.trim_end_matches('/')));
        let result = if inside {
            Err("A folder can't go inside itself.".to_string())
        } else {
            node_id(&space, path).and_then(|id| {
                let name = drive
                    .node_at(&space, path)
                    .map_err(error_text)?
                    .map(|node| node.name)
                    .ok_or_else(|| "It isn't there any more.".to_string())?;
                drive
                    .rename_checked(
                        &space,
                        &id,
                        target.as_ref(),
                        &name,
                        replace.unwrap_or(false),
                    )
                    .map_err(|error| placed_error(error, &name))
                    .and_then(|node| entry_of(&space, &node.id))
            })
        };
        match result {
            Ok(entry) => moved.push(entry),
            Err(error) if error.starts_with("exists:") => {
                taken.get_or_insert(error);
            }
            Err(error) => {
                refused.get_or_insert(error);
            }
        }
    }
    if let Some(taken) = taken {
        return Err(taken);
    }
    match (moved.is_empty(), refused) {
        (true, Some(error)) => Err(error),
        _ => Ok(moved),
    }
}
