use std::path::{Path, PathBuf};

use file_access::disk::fs_disk;
use space_drive::SpaceId;
use tauri::{AppHandle, Manager};

use super::display_name;

#[path = "agent_trash_moves.rs"]
mod moves;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Landed {
    SpaceTrash,
    SystemTrash,
}

fn connect(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    app.state::<crate::app::runtime::MistyRuntime>()
        .environment
        .store()
        .connect()
        .map_err(|error| error.to_string())
}

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

pub fn move_to_trash_for_agent(app: &AppHandle, path: &Path) -> Result<Landed, String> {
    if let Some((space, drive_path)) = drive_item(path) {
        let drive = crate::spaces_drive::drive()?;
        let node = drive
            .node_at(&space, &drive_path)
            .map_err(crate::spaces_drive::error_text)?
            .ok_or_else(|| format!("{} isn't there any more.", display_name(path)))?;
        if drive
            .in_trash(&space, &node.id)
            .map_err(crate::spaces_drive::error_text)?
        {
            return Err(format!(
                "{} is already in the Space's .trash, which only a person empties.",
                display_name(path)
            ));
        }
        drive
            .trash(&space, &node.id)
            .map_err(crate::spaces_drive::error_text)?;
        return Ok(Landed::SpaceTrash);
    }
    super::trash::attach(app);
    let (_, failures) = super::trash::trash_paths(&[path.to_path_buf()]);
    match failures.into_iter().next() {
        Some(failure) => Err(failure.error),
        None => Ok(Landed::SystemTrash),
    }
}

fn to_system_trash(app: &AppHandle, original: &Path, holding: &Path) -> Result<(), String> {
    if !moves::held_exists(holding) {
        return Ok(());
    }
    let folder = original
        .parent()
        .ok_or("That item has no folder to go back to.")?;
    let target: PathBuf = if fs_disk::exists(original) {
        super::transfer::keep_both_name(folder, &display_name(original))
    } else {
        original.to_path_buf()
    };
    moves::out_of_holding(holding, &target)?;
    super::trash::attach(app);
    let (_, failures) = super::trash::trash_paths(&[target]);
    failures
        .into_iter()
        .next()
        .map_or(Ok(()), |failure| Err(failure.error))
}

pub(crate) fn retire(app: &AppHandle) {
    let Ok(connection) = connect(app) else {
        return;
    };
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'files_agent_trash')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .unwrap_or(false);
    if !exists {
        return;
    }
    let rows: Vec<(i64, String, Option<String>)> = connection
        .prepare("SELECT id, original_path, holding_path FROM files_agent_trash")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map(|found| found.flatten().collect())
        })
        .unwrap_or_default();
    let mut kept = 0;
    for (id, original, holding) in rows {
        let done = match holding {
            Some(holding) => to_system_trash(app, Path::new(&original), Path::new(&holding)),
            None => Ok(()),
        };
        match done {
            Ok(()) => {
                let _ = connection.execute("DELETE FROM files_agent_trash WHERE id = ?1", [id]);
            }
            Err(_) => kept += 1,
        }
    }
    if kept == 0 {
        let _ = connection.execute_batch("DROP TABLE files_agent_trash");
        moves::remove_empty_holding();
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn agents_never_delete_outright() {
        let source = include_str!("agent_trash.rs");
        let direct = ["trash", "::delete("].concat();
        assert!(!source.contains(&direct));
        assert!(source.contains(".in_trash("));
    }
}
