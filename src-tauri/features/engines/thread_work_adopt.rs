use std::path::Path;

use database::store::Store;
use serde_json::Value;
use space_drive::{Drive, SpaceId};
use tauri::{AppHandle, Manager};

use super::{load, local_of, plan_folder, save, space_lock, text, walk, Place, Row};
use crate::app::runtime::MistyRuntime;
use crate::engines::chat_folder;
use crate::engines::commands::blocking;
use crate::engines::store;

fn prune(dir: &Path) -> bool {
    let Ok(entries) = file_access::fs::read_dir(dir) else {
        return false;
    };
    let mut empty = true;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(info) = file_access::fs::symlink_metadata(&path) else {
            empty = false;
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let disposable = info.is_dir()
            && !info.file_type().is_symlink()
            && (super::ENGINE_CONFIG
                .iter()
                .any(|config| name.eq_ignore_ascii_case(config))
                || space_drive::ignore::HEAVY_FOLDERS.contains(&name.as_str()));
        if disposable {
            if file_access::fs::remove_dir_all(&path).is_err() {
                empty = false;
            }
        } else if info.is_dir() && !info.file_type().is_symlink() {
            if !prune(&path) {
                empty = false;
            }
        } else if info.is_file()
            && super::ENGINE_CONFIG
                .iter()
                .any(|config| name.eq_ignore_ascii_case(config))
        {
            if file_access::fs::remove_file(&path).is_err() {
                empty = false;
            }
        } else {
            empty = false;
        }
    }
    empty && file_access::fs::remove_dir(dir).is_ok()
}

pub(super) fn move_scratch(
    db: &Store,
    drive: &Drive,
    account: &str,
    conversation: &str,
    row: &Row,
) -> Result<(), String> {
    let scratch = chat_folder::scratch_for(db, conversation)?;
    if !file_access::fs::is_dir(&scratch) {
        return store::drop_chat_folder(db, account, conversation, chat_folder::SCRATCH);
    }
    let space = SpaceId(row.space.clone());
    for path in walk(&scratch).into_keys() {
        let into = format!("{}{path}", row.folder);
        if drive
            .node_at(&space, &into)
            .map_err(crate::spaces_drive::error_text)?
            .is_some()
        {
            continue;
        }
        let source = local_of(&scratch, &path);
        let _ = drive.make_folders(&space, &space_drive::names::parent(&into));
        super::land::write_one(drive, &space, &into, None, Some(&source), None)?;
        let _ = file_access::fs::remove_file(&source);
    }
    if prune(&scratch) {
        store::drop_chat_folder(db, account, conversation, chat_folder::SCRATCH)?;
    }
    Ok(())
}

struct Waiting {
    account: String,
    conversation: String,
    place: Place,
}

fn document(db: &Store, account: &str, kind: &str, id: &str) -> Option<Value> {
    let raw: String = db
        .connect()
        .ok()?
        .query_row(
            "SELECT document FROM agent_chats WHERE account = ?1 AND kind = ?2 AND id = ?3",
            [account, kind, id],
            |row| row.get(0),
        )
        .ok()?;
    serde_json::from_str(&raw).ok()
}

fn waiting_in(db: &Store, space: &str) -> Result<Vec<Waiting>, String> {
    let mut out = Vec::new();
    for (account, conversation) in store::scratch_chats(db)? {
        let Some(chat) = document(db, &account, "conversation", &conversation) else {
            continue;
        };
        if chat["spaceId"].as_str() != Some(space) {
            continue;
        }
        let agent_id = chat["agentId"].as_str().unwrap_or("").to_string();
        let agent = document(db, &account, "agent", &agent_id)
            .and_then(|agent| agent["name"].as_str().map(str::to_string))
            .unwrap_or_default();
        out.push(Waiting {
            place: Place {
                space: space.to_string(),
                agent_id,
                agent,
                title: chat["title"].as_str().unwrap_or("").to_string(),
            },
            account,
            conversation,
        });
    }
    Ok(out)
}

fn adopt_one(db: &Store, drive: &Drive, waiting: &Waiting) -> Result<(), String> {
    let (account, conversation) = (&waiting.account, &waiting.conversation);
    let row = match load(db, account, conversation)? {
        Some(row) => row,
        None => {
            let row = Row {
                space: waiting.place.space.clone(),
                agent_id: waiting.place.agent_id.clone(),
                folder: plan_folder(db, drive, conversation, &waiting.place)?,
                state: "idle".into(),
                started: false,
                clashes: Vec::new(),
                note: String::new(),
            };
            let _ = drive.make_folders(&SpaceId(row.space.clone()), &row.folder);
            save(db, account, conversation, &row)?;
            row
        }
    };
    move_scratch(db, drive, account, conversation, &row)
}

pub(crate) fn adopt_scratch(app: &AppHandle, space: &str) {
    let app = app.clone();
    let space = space.to_string();
    tauri::async_runtime::spawn(async move {
        let Ok(drive) = crate::spaces_drive::drive() else {
            return;
        };
        let lock = space_lock(&space);
        let _turn = lock.lock().await;
        let db = app.state::<MistyRuntime>().environment.store();
        let done = blocking(move || {
            for waiting in waiting_in(&db, &space)? {
                if let Err(error) = adopt_one(&db, &drive, &waiting) {
                    eprintln!(
                        "[threads] moving {}'s scratch folder into its Space failed: {error}",
                        waiting.conversation
                    );
                }
            }
            Ok::<(), String>(())
        })
        .await;
        if let Err(error) = done {
            eprintln!("[threads] {}", text(error));
        }
    });
}
