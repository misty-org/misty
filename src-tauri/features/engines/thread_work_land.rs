use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use database::store::Store;
use space_drive::rules::{is_text, merge_text, MAX_TEXT};
use space_drive::{names, Drive, ItemId, Kind, Node, SpaceId, Version};
use tauri::AppHandle;

use super::{
    caught_up, clear_meta, load, local_of, read_snapshot, save, sha_of, space_lock, start_copy,
    tell, view, walk, workspace, write_known, write_snapshot, Clash, ThreadView,
};
use crate::engines::commands::blocking;

const IN_MEMORY_MOST: u64 = 64 * 1024 * 1024;

enum Op {
    Write {
        path: String,
        source: PathBuf,
        replace: Option<(ItemId, Version)>,
    },
    Merged {
        path: String,
        bytes: Vec<u8>,
        replace: Option<(ItemId, Version)>,
    },
    Trash {
        path: String,
        id: ItemId,
    },
}

fn error_text(error: space_drive::DriveError) -> String {
    crate::spaces_drive::error_text(error)
}

fn replace_of(node: &Node) -> (ItemId, Version) {
    (node.id.clone(), node.version.unwrap_or(Version(0)))
}

fn start_text(db: &Store, conversation: &str, path: &str, sha: &str) -> Option<String> {
    let copy = local_of(&start_copy(db, conversation).ok()?, path);
    if sha_of(&copy).as_deref() != Some(sha) {
        return None;
    }
    let bytes = file_access::fs::read(copy).ok()?;
    is_text(&bytes)
        .then(|| String::from_utf8(bytes).ok())
        .flatten()
}

async fn merged(
    db: &Store,
    conversation: &str,
    drive: &Drive,
    space: &SpaceId,
    node: &Node,
    base_sha: &str,
    local: &Path,
) -> Option<Vec<u8>> {
    if node.size > MAX_TEXT {
        return None;
    }
    let base = drive
        .base_text(&node.id, base_sha)
        .or_else(|| start_text(db, conversation, &node.path, base_sha))?;
    let ours = file_access::fs::read(local).ok()?;
    if ours.len() as u64 > MAX_TEXT || !is_text(&ours) {
        return None;
    }
    let ours = String::from_utf8(ours).ok()?;
    let theirs = drive.read_capped(space, &node.path, MAX_TEXT).await.ok()?;
    if !is_text(&theirs) {
        return None;
    }
    let theirs = String::from_utf8(theirs).ok()?;
    merge_text(&base, &ours, &theirs).map(String::into_bytes)
}

fn write_one(
    drive: &Drive,
    space: &SpaceId,
    path: &str,
    bytes: Option<&[u8]>,
    source: Option<&Path>,
    replace: Option<(ItemId, Version)>,
) -> Result<(), String> {
    let folder = names::parent(path);
    let name = names::file_name(path).to_string();
    if let Some(bytes) = bytes {
        drive
            .write_bytes(space, &folder, &name, bytes, replace)
            .map_err(error_text)?;
        return Ok(());
    }
    let source = source.ok_or("Misty lost track of a file to land.")?;
    let size = file_access::fs::metadata(source)
        .map_err(|error| error.to_string())?
        .len();
    if size <= IN_MEMORY_MOST {
        let bytes = file_access::fs::read(source).map_err(|error| error.to_string())?;
        drive
            .write_bytes(space, &folder, &name, &bytes, replace)
            .map_err(error_text)?;
        return Ok(());
    }
    let temp = drive.temp_path();
    file_access::fs::copy(source, &temp).map_err(|error| error.to_string())?;
    let mtime = chrono::Utc::now().timestamp_millis();
    let (id, base) = match replace {
        Some((id, version)) => (id, Some(version)),
        None => {
            let made = drive
                .write_bytes(space, &folder, &name, &[], None)
                .map_err(error_text)?;
            (made.id, None)
        }
    };
    let done = drive.modify(space, &id, base, None, None, Some(&temp), mtime);
    let _ = file_access::fs::remove_file(&temp);
    done.map(|_| ()).map_err(error_text)
}

fn apply(drive: &Drive, space: &SpaceId, ops: &[Op]) -> Result<(), String> {
    for op in ops {
        match op {
            Op::Write {
                path,
                source,
                replace,
            } => write_one(drive, space, path, None, Some(source), replace.clone())?,
            Op::Merged {
                path,
                bytes,
                replace,
            } => write_one(drive, space, path, Some(bytes), None, replace.clone())?,
            Op::Trash { id, .. } => {
                if !drive.in_trash(space, id).map_err(error_text)? {
                    drive.trash(space, id).map_err(error_text)?;
                }
            }
        }
    }
    Ok(())
}

fn record_outputs(db: &Store, account: &str, conversation: &str, ops: &[Op]) -> Result<(), String> {
    let connection = db.connect().map_err(|error| error.to_string())?;
    let at = chrono::Utc::now().timestamp_millis();
    for op in ops {
        match op {
            Op::Write { path, .. } | Op::Merged { path, .. } => {
                connection
                    .execute(
                        "INSERT INTO thread_outputs (account, conversation_id, path, landed_at)
                         VALUES (?1, ?2, ?3, ?4)
                         ON CONFLICT (account, conversation_id, path) DO UPDATE SET landed_at = ?4",
                        rusqlite::params![account, conversation, path, at],
                    )
                    .map_err(|error| error.to_string())?;
            }
            Op::Trash { path, .. } => {
                connection
                    .execute(
                        "DELETE FROM thread_outputs
                         WHERE account = ?1 AND conversation_id = ?2 AND path = ?3",
                        rusqlite::params![account, conversation, path],
                    )
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

fn prune(dir: &Path, keep: &Path) {
    let Ok(entries) = file_access::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep {
            continue;
        }
        let is_dir = file_access::fs::symlink_metadata(&path)
            .map(|info| info.is_dir())
            .unwrap_or(false);
        if is_dir && keep.starts_with(&path) {
            prune(&path, keep);
        } else if is_dir {
            let _ = file_access::fs::remove_dir_all(&path);
        } else {
            let _ = file_access::fs::remove_file(&path);
        }
    }
}

pub(crate) async fn land(
    app: &AppHandle,
    db: &Store,
    account: &str,
    conversation: &str,
    turn_ended: bool,
) -> Result<Option<ThreadView>, String> {
    let Some(first) = load(db, account, conversation)? else {
        return Ok(None);
    };
    let lock = space_lock(&first.space);
    let _landing = lock.lock().await;
    let Some(mut row) = load(db, account, conversation)? else {
        return Ok(None);
    };
    if row.state == "working" && !turn_ended {
        return Ok(Some(view(conversation, &row)));
    }
    if !row.started {
        if row.state != "idle" {
            row.state = "idle".into();
            save(db, account, conversation, &row)?;
            tell(app, conversation, &row);
        }
        return Ok(Some(view(conversation, &row)));
    }
    let space = SpaceId(row.space.clone());
    let drive = match crate::spaces_drive::drive() {
        Ok(drive) if caught_up(&drive, &space) => drive,
        _ => {
            row.state = "held".into();
            save(db, account, conversation, &row)?;
            tell(app, conversation, &row);
            return Ok(Some(view(conversation, &row)));
        }
    };
    row.state = "landing".into();
    row.clashes.clear();
    save(db, account, conversation, &row)?;
    tell(app, conversation, &row);

    let root = workspace(db, conversation)?;
    let snapshot = read_snapshot(db, conversation)?;
    let now = {
        let root = root.clone();
        blocking(move || Ok(walk(&root))).await?
    };
    let mut changed: BTreeSet<String> = now
        .iter()
        .filter(|(path, sha)| snapshot.work.get(*path) != Some(*sha))
        .map(|(path, _)| path.clone())
        .collect();
    changed.extend(
        snapshot
            .work
            .keys()
            .filter(|path| !now.contains_key(*path))
            .cloned(),
    );

    let mut ops = Vec::new();
    let mut clashes = Vec::new();
    for path in changed {
        if drive.ignored(&space, &path, false).unwrap_or(false) {
            continue;
        }
        let start = snapshot.space.get(&path).cloned();
        let current = drive.node_at(&space, &path).map_err(error_text)?;
        if current
            .as_ref()
            .is_some_and(|node| node.kind == Kind::Folder)
        {
            clashes.push(Clash {
                path,
                kind: "folder".into(),
            });
            continue;
        }
        let current_sha = current.as_ref().and_then(|node| node.sha256.clone());
        match now.get(&path) {
            Some(ours) => {
                if current_sha.as_deref() == Some(ours.as_str()) {
                    continue;
                }
                let local = local_of(&root, &path);
                if current_sha == start {
                    ops.push(Op::Write {
                        replace: current.as_ref().map(replace_of),
                        path,
                        source: local,
                    });
                    continue;
                }
                let joined = match (&current, &start) {
                    (Some(node), Some(base)) => {
                        merged(db, conversation, &drive, &space, node, base, &local).await
                    }
                    _ => None,
                };
                match joined {
                    Some(bytes) => ops.push(Op::Merged {
                        replace: current.as_ref().map(replace_of),
                        path,
                        bytes,
                    }),
                    None => clashes.push(Clash {
                        kind: match (&current, &start) {
                            (None, _) => "deleted".into(),
                            (Some(_), None) => "created".into(),
                            _ => "changed".into(),
                        },
                        path,
                    }),
                }
            }
            None => match current {
                None => {}
                Some(node) if current_sha == start => ops.push(Op::Trash { path, id: node.id }),
                Some(_) => clashes.push(Clash {
                    path,
                    kind: "changed".into(),
                }),
            },
        }
    }

    if !clashes.is_empty() {
        row.state = "clashed".into();
        row.clashes = clashes;
        save(db, account, conversation, &row)?;
        tell(app, conversation, &row);
        return Ok(Some(view(conversation, &row)));
    }

    let applied = {
        let (drive, space) = (drive.clone(), space.clone());
        tokio::task::spawn_blocking(move || {
            let result = apply(&drive, &space, &ops);
            (ops, result)
        })
        .await
        .map_err(|error| error.to_string())?
    };
    let (ops, result) = applied;
    if let Err(error) = result {
        row.state = "held".into();
        row.note = error.clone();
        save(db, account, conversation, &row)?;
        tell(app, conversation, &row);
        return Err(error);
    }
    record_outputs(db, account, conversation, &ops)?;

    let keep = local_of(&root, &row.folder);
    {
        let (root, keep) = (root.clone(), keep.clone());
        blocking(move || {
            prune(&root, &keep);
            Ok(())
        })
        .await?;
    }
    let agreed: BTreeMap<String, String> = now
        .into_iter()
        .filter(|(path, _)| names::is_within(path, &row.folder) && path != &row.folder)
        .collect();
    write_known(db, conversation, &agreed)?;
    clear_meta(db, conversation);
    row.started = false;
    row.state = "idle".into();
    row.note = String::new();
    save(db, account, conversation, &row)?;
    tell(app, conversation, &row);
    Ok(Some(view(conversation, &row)))
}

pub(crate) async fn resolve(
    app: &AppHandle,
    db: &Store,
    account: &str,
    conversation: &str,
    path: Option<&str>,
    choice: &str,
) -> Result<Option<ThreadView>, String> {
    let Some(first) = load(db, account, conversation)? else {
        return Ok(None);
    };
    let drive = crate::spaces_drive::drive()?;
    let space = SpaceId(first.space.clone());
    {
        let lock = space_lock(&first.space);
        let _resolving = lock.lock().await;
        let Some(mut row) = load(db, account, conversation)? else {
            return Ok(None);
        };
        let picked: Vec<Clash> = row
            .clashes
            .iter()
            .filter(|clash| path.is_none_or(|wanted| clash.path == wanted))
            .cloned()
            .collect();
        if picked.is_empty() {
            return Ok(Some(view(conversation, &row)));
        }
        let root = workspace(db, conversation)?;
        let mut snapshot = read_snapshot(db, conversation)?;
        for clash in &picked {
            let current = drive.node_at(&space, &clash.path).map_err(error_text)?;
            let current_sha = current
                .as_ref()
                .filter(|node| node.kind == Kind::File)
                .and_then(|node| node.sha256.clone());
            match choice {
                "theirs" => {
                    let local = local_of(&root, &clash.path);
                    match (&current, &current_sha) {
                        (Some(node), Some(sha)) => {
                            let bytes = drive
                                .read_bytes(&space, &node.path)
                                .await
                                .map_err(error_text)?;
                            if let Some(parent) = local.parent() {
                                file_access::fs::create_dir_all(parent)
                                    .map_err(|error| error.to_string())?;
                            }
                            file_access::fs::write(&local, bytes)
                                .map_err(|error| error.to_string())?;
                            snapshot.work.insert(clash.path.clone(), sha.clone());
                        }
                        _ => {
                            let _ = file_access::fs::remove_file(&local);
                            snapshot.work.remove(&clash.path);
                        }
                    }
                }
                "mine" | "agent" => {}
                _ => return Err("That isn't a way to settle a clash.".into()),
            }
            match &current_sha {
                Some(sha) => {
                    snapshot.space.insert(clash.path.clone(), sha.clone());
                }
                None => {
                    snapshot.space.remove(&clash.path);
                }
            }
        }
        write_snapshot(db, conversation, &snapshot)?;
        row.clashes
            .retain(|clash| !picked.iter().any(|done| done.path == clash.path));
        if choice == "agent" {
            row.clashes.clear();
            row.state = "working".into();
            save(db, account, conversation, &row)?;
            tell(app, conversation, &row);
            return Ok(Some(view(conversation, &row)));
        }
        save(db, account, conversation, &row)?;
        tell(app, conversation, &row);
        if !row.clashes.is_empty() {
            return Ok(Some(view(conversation, &row)));
        }
    }
    land(app, db, account, conversation, false).await
}
