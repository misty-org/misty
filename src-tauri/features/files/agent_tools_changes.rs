use std::path::Path;

use file_access::{disk::fs_disk, Access};
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{all_failed, failure, path_list, text, Agent};
use crate::files::{
    agent_paths::{admit, admit_path},
    agent_trash::move_to_agent_trash,
    display_name,
    entry::{entry_for, FinderTag},
    failed, search,
};

fn shown(path: &Path) -> String {
    path.display().to_string()
}

fn valid_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > 255
        || name.contains(['/', '\\', '\0']);
    if bad {
        return Err(format!(
            "{name:?} can't be a name: use one without slashes."
        ));
    }
    Ok(name)
}

fn crosses_drives(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    let code = libc::EXDEV;
    #[cfg(windows)]
    let code = 17;
    #[cfg(not(any(unix, windows)))]
    let code = -1;
    error.raw_os_error() == Some(code)
}

pub(super) fn create_folder(input: &Value) -> Result<Value, String> {
    let path = admit(text(input, "path")?, Access::Write)?;
    let name = display_name(&path);
    valid_name(&name)?;
    fs_disk::create_dir(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!("{name} is there already.")
        } else {
            failed(&path, error)
        }
    })?;
    search::note_added(&path);
    let created = entry_for(&path).map_err(|error| failed(&path, error))?;
    Ok(json!({ "created": created }))
}

pub(super) fn rename(input: &Value) -> Result<Value, String> {
    let path = admit(text(input, "path")?, Access::Write)?;
    let name = valid_name(text(input, "name")?)?;
    let folder = path
        .parent()
        .ok_or_else(|| format!("{} can't be renamed.", display_name(&path)))?;
    let target = admit_path(&folder.join(name), Access::Write)?;
    if target == path {
        return Ok(json!({ "renamed": { "from": shown(&path), "to": shown(&target) } }));
    }
    let case_only = display_name(&path).to_lowercase() == name.to_lowercase();
    if !case_only && fs_disk::exists(&target) {
        return Err(format!("An item named {name} is there already."));
    }
    fs_disk::rename(&path, &target).map_err(|error| failed(&path, error))?;
    search::note_renamed(&path, &target);
    Ok(json!({ "renamed": { "from": shown(&path), "to": shown(&target) } }))
}

fn copy_item(source: &Path, target: &Path) -> std::io::Result<()> {
    let meta = fs_disk::symlink_metadata(source)?;
    if meta.file_type().is_symlink() {
        let points_to = fs_disk::read_link(source)?;
        return fs_disk::symlink(points_to, target);
    }
    if meta.is_dir() {
        return fs_disk::copy_tree(source, target);
    }
    fs_disk::copy(source, target).map(|_| ())
}

fn transfer_one(source: &str, folder: &Path, copy: bool) -> Result<Value, String> {
    let source = admit(source, if copy { Access::Read } else { Access::Write })?;
    let name = display_name(&source);
    let target = admit_path(&folder.join(&name), Access::Write)?;
    if target == source {
        return Err(format!("{name} is in that folder already."));
    }
    if folder.starts_with(&source) {
        return Err(format!("{name} can't go inside itself."));
    }
    if fs_disk::exists(&target) {
        return Err(format!(
            "An item named {name} is in that folder already. Rename one first."
        ));
    }
    if copy {
        copy_item(&source, &target).map_err(|error| failed(&source, error))?;
        search::note_added(&target);
    } else {
        fs_disk::rename(&source, &target).map_err(|error| {
            if crosses_drives(&error) {
                format!(
                    "{name} is on another drive, and moving it there would mean deleting the \
original. Copy it instead."
                )
            } else {
                failed(&source, error)
            }
        })?;
        search::note_renamed(&source, &target);
    }
    Ok(json!({ "from": shown(&source), "to": shown(&target) }))
}

pub(super) fn transfer(input: &Value, copy: bool) -> Result<Value, String> {
    let sources = path_list(input, "paths")?;
    let folder = admit(text(input, "to")?, Access::Write)?;
    if !fs_disk::is_dir(&folder) {
        return Err(format!("{} isn't a folder.", display_name(&folder)));
    }
    let (mut done, mut failures) = (Vec::new(), Vec::new());
    for source in &sources {
        match transfer_one(source, &folder, copy) {
            Ok(went) => done.push(went),
            Err(error) => failures.push(failure(source, error)),
        }
    }
    all_failed(&done, &failures)?;
    let mut result = json!({ "failed": failures });
    result[if copy { "copied" } else { "moved" }] = json!(done);
    Ok(result)
}

pub(super) fn trash(app: &AppHandle, agent: &Agent, input: &Value) -> Result<Value, String> {
    let paths = path_list(input, "paths")?;
    let (mut done, mut failures) = (Vec::new(), Vec::new());
    for asked in &paths {
        let held = admit(asked, Access::Write).and_then(|path| {
            let id = move_to_agent_trash(app, &path, &agent.id, agent.chat.as_deref())?;
            search::note_removed(&path);
            Ok((path, id))
        });
        match held {
            Ok((path, id)) => done.push(json!({ "path": shown(&path), "agentTrashId": id })),
            Err(error) => failures.push(failure(asked, error)),
        }
    }
    all_failed(&done, &failures)?;
    Ok(json!({
        "trashed": done,
        "failed": failures,
        "note": "These wait in Agent trash, where the person puts back or deletes them. Nothing was deleted.",
    }))
}

pub(super) fn tag(input: &Value) -> Result<Value, String> {
    if !cfg!(target_os = "macos") {
        return Err("Tags are Finder's, so they work only on a Mac.".into());
    }
    let paths = path_list(input, "paths")?;
    let tags = input["tags"]
        .as_array()
        .ok_or("Say which tags, as a list (an empty one clears them).")?
        .iter()
        .map(|tag| -> Result<FinderTag, String> {
            let name = tag["name"]
                .as_str()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .ok_or("Each tag needs a name.")?;
            Ok(FinderTag {
                name: name.to_owned(),
                color: tag["color"].as_u64().unwrap_or(0).min(7) as u8,
            })
        })
        .collect::<Result<Vec<FinderTag>, String>>()?;
    let (mut done, mut failures) = (Vec::new(), Vec::new());
    for asked in &paths {
        let tagged = admit(asked, Access::Write).and_then(|path| {
            crate::files::tags::write_tags(&path, &tags)
                .map(|()| shown(&path))
                .map_err(|error| failed(&path, error))
        });
        match tagged {
            Ok(path) => done.push(json!(path)),
            Err(error) => failures.push(failure(asked, error)),
        }
    }
    all_failed(&done, &failures)?;
    Ok(json!({ "tagged": done, "tags": tags, "failed": failures }))
}

pub(super) fn delete(input: &Value) -> Result<Value, String> {
    let paths = path_list(input, "paths")?;
    let (mut done, mut failures) = (Vec::new(), Vec::new());
    for asked in &paths {
        let gone = admit(asked, Access::Write).and_then(|path| {
            let meta = fs_disk::symlink_metadata(&path).map_err(|error| failed(&path, error))?;
            let removed = if meta.is_dir() {
                fs_disk::remove_dir_all(&path)
            } else {
                fs_disk::remove_file(&path)
            };
            removed.map_err(|error| failed(&path, error))?;
            search::note_removed(&path);
            Ok(shown(&path))
        });
        match gone {
            Ok(path) => done.push(json!(path)),
            Err(error) => failures.push(failure(asked, error)),
        }
    }
    all_failed(&done, &failures)?;
    Ok(json!({ "deleted": done, "failed": failures }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_have_no_folders_in_them() {
        assert_eq!(valid_name(" Notes ").unwrap(), "Notes");
        for bad in ["", ".", "..", "a/b", "a\\b"] {
            assert!(valid_name(bad).is_err(), "{bad:?}");
        }
        assert!(valid_name(&"x".repeat(256)).is_err());
    }
}
