use std::{
    io::Read,
    time::{Duration, Instant},
};

use file_access::{
    disk::{fs_disk, walk, ItemKind},
    Access,
};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::{admit, admit_path};
use crate::files::{
    display_name,
    entry::{entry_for, is_package_name, FileEntry, FileKind},
    failed, gated,
};

#[path = "agent_tools_archive.rs"]
mod archive;
#[path = "agent_tools_changes.rs"]
mod changes;

pub(crate) const INSTRUCTIONS: &str = "The files_* tools reach the files on this computer that \
the person let Files open, by full path (start from their home folder). They never reach Misty's \
data, keys or other secrets. Each change asks the person first unless they chose a no-asking mode. \
Never delete: to clean up, propose a plan, then move what should go with files_trash: a Space's \
files go to its .trash and other files to the system Trash, where the person looks them over. files_reveal shows an item in the person's Files.";

pub(crate) const DELETE: &str = "files.delete";
pub(crate) const REVEAL_EVENT: &str = "files://reveal";

const LIST_MOST: usize = 500;
const SEARCH_MOST: usize = 200_000;
const SEARCH_TIME: Duration = Duration::from_secs(10);
const READ_DEFAULT: u64 = 100_000;
const READ_MOST: u64 = 262_144;
const PATHS_MOST: usize = 200;

pub(crate) fn disk_on() -> bool {
    file_access::disk::disk_allowed()
}

pub(crate) fn offered(app: &AppHandle, name: &str) -> bool {
    if !(name.starts_with("files.") || name.starts_with("files_")) {
        return true;
    }
    if !disk_on() {
        return false;
    }
    if name == DELETE || name == "files_delete" {
        return permissions::agent_delete_on(app);
    }
    true
}

#[derive(Debug)]
pub(crate) struct Refused {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

pub(crate) async fn call(
    app: &AppHandle,
    _agent_id: &str,
    _chat_id: &str,
    name: &str,
    input: Value,
) -> Result<Value, Refused> {
    if !disk_on() {
        return Err(Refused {
            code: "disk_off",
            message: "Files hasn't been given access to this computer. The person turns it on by \
opening Files. Nothing was done."
                .to_owned(),
        });
    }
    if name == DELETE && !permissions::agent_delete_on(app) {
        return Err(Refused {
            code: "delete_off",
            message: "Agents don't delete files. Move it to the trash with files.trash instead. \
Nothing was deleted."
                .to_owned(),
        });
    }
    let (app, name) = (app.clone(), name.to_owned());
    tokio::task::spawn_blocking(move || run(&app, &name, &input))
        .await
        .map_err(|error| Refused {
            code: "files_failed",
            message: error.to_string(),
        })?
        .map_err(|message| Refused {
            code: "files_failed",
            message,
        })
}

fn run(app: &AppHandle, name: &str, input: &Value) -> Result<Value, String> {
    match name {
        "files.list" => list(input),
        "files.search" => search(input),
        "files.info" => info(input),
        "files.read" => read(input),
        "files.reveal" => reveal(app, input),
        "files.create_folder" => changes::create_folder(input),
        "files.rename" => changes::rename(input),
        "files.move" => changes::transfer(input, false),
        "files.copy" => changes::transfer(input, true),
        "files.trash" => changes::trash(app, input),
        "files.tag" => changes::tag(input),
        "files.zip" => archive::zip(input),
        "files.extract" => archive::extract(input),
        DELETE => changes::delete(input),
        _ => Err(format!("There is no tool named {name}.")),
    }
}

pub(super) fn text<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input[key]
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("Say {key}."))
}

pub(super) fn optional<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input[key]
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
}

pub(super) fn path_list(input: &Value, key: &str) -> Result<Vec<String>, String> {
    let paths: Vec<String> = input[key]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|path| path.as_str().map(str::trim).filter(|path| !path.is_empty()))
        .map(str::to_owned)
        .collect();
    if paths.is_empty() {
        return Err(format!("Say which {key}."));
    }
    if paths.len() > PATHS_MOST {
        return Err(format!("Name at most {PATHS_MOST} paths in one call."));
    }
    Ok(paths)
}

pub(super) fn failure(path: &str, error: impl std::fmt::Display) -> Value {
    json!({ "path": path, "error": error.to_string() })
}

pub(super) fn all_failed(done: &[Value], failures: &[Value]) -> Result<(), String> {
    if !done.is_empty() || failures.is_empty() {
        return Ok(());
    }
    Err(failures
        .iter()
        .filter_map(|failure| failure["error"].as_str())
        .collect::<Vec<_>>()
        .join(" "))
}

fn folders_first(entries: &mut [FileEntry]) {
    entries.sort_by_key(|entry| {
        (
            !matches!(entry.kind, FileKind::Folder),
            entry.name.to_lowercase(),
        )
    });
}

fn list(input: &Value) -> Result<Value, String> {
    let folder = admit(text(input, "path")?, Access::Read)?;
    let hidden = input["hidden"].as_bool() == Some(true);
    let opened = gated::dir(&folder, Access::Read, walk::WalkFor::Agent)
        .map_err(|error| failed(&folder, error))?;
    let items = opened.read_dir().map_err(|error| failed(&folder, error))?;
    let (mut entries, mut more) = (Vec::new(), false);
    for item in items {
        let path = folder.join(&item.name);
        if !hidden && item.name.to_string_lossy().starts_with('.') {
            continue;
        }
        if file_access::disk::check_agent(&path, Access::Read).is_err() {
            continue;
        }
        let Ok(entry) = entry_for(&path) else {
            continue;
        };
        if !hidden && entry.hidden {
            continue;
        }
        if entries.len() >= LIST_MOST {
            more = true;
            break;
        }
        entries.push(entry);
    }
    folders_first(&mut entries);
    Ok(json!({ "path": folder.display().to_string(), "entries": entries, "more": more }))
}

fn search(input: &Value) -> Result<Value, String> {
    let query = text(input, "query")?.to_lowercase();
    let words: Vec<&str> = query.split_whitespace().collect();
    let home = dirs::home_dir();
    let root = match optional(input, "folder") {
        Some(folder) => admit(folder, Access::Read)?,
        None => {
            let home = home
                .clone()
                .ok_or("Misty couldn't find your home folder.")?;
            admit_path(&home, Access::Read)?
        }
    };
    let limit = input["limit"].as_u64().unwrap_or(30).clamp(1, 100) as usize;
    let dotted = query.starts_with('.');
    let library = home.map(|home| home.join("Library"));
    let started = Instant::now();
    let (mut found, mut seen, mut complete) = (Vec::new(), 0usize, true);
    let walked = walk::walk(&root, Access::Read, walk::WalkFor::Agent, &mut |step| {
        seen += 1;
        if seen > SEARCH_MOST || started.elapsed() > SEARCH_TIME {
            complete = false;
            return Ok(walk::WalkFlow::Stop);
        }
        let name = step.item.name.to_string_lossy().into_owned();
        let hidden = !dotted && name.starts_with('.');
        let lower = name.to_lowercase();
        let matches = !hidden && words.iter().all(|word| lower.contains(word));
        let path = step.dir.path().join(&step.item.name);
        let mut flow = walk::WalkFlow::Continue;
        if step.item.kind == ItemKind::Dir {
            let skip = hidden
                || step.depth >= 16
                || name == "node_modules"
                || is_package_name(&name)
                || (cfg!(target_os = "macos") && library.as_deref() == Some(path.as_path()));
            if skip {
                flow = walk::WalkFlow::SkipDir;
            }
        }
        if matches {
            if let Ok(entry) = entry_for(&path) {
                found.push(entry);
                if found.len() >= limit {
                    complete = false;
                    return Ok(walk::WalkFlow::Stop);
                }
            }
        }
        Ok(flow)
    });
    walked.map_err(|error| failed(&root, error))?;
    Ok(json!({ "folder": root.display().to_string(), "results": found, "complete": complete }))
}

#[cfg(unix)]
fn mode_text(meta: &fs_disk::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    let mode = meta.permissions().mode();
    let marks = ['r', 'w', 'x'];
    (0..9)
        .map(|bit| {
            if mode & (1 << (8 - bit)) != 0 {
                marks[bit % 3]
            } else {
                '-'
            }
        })
        .collect()
}

#[cfg(not(unix))]
fn mode_text(meta: &fs_disk::Metadata) -> String {
    if meta.permissions().readonly() {
        "Read only"
    } else {
        "Read and write"
    }
    .to_owned()
}

fn info(input: &Value) -> Result<Value, String> {
    let path = admit(text(input, "path")?, Access::Read)?;
    let entry = entry_for(&path).map_err(|error| failed(&path, error))?;
    let meta = fs_disk::symlink_metadata(&path).map_err(|error| failed(&path, error))?;
    let items = matches!(entry.kind, FileKind::Folder | FileKind::Package)
        .then(|| fs_disk::read_dir(&path).map(|items| items.count()).ok())
        .flatten();
    Ok(json!({
        "entry": entry,
        "parent": path.parent().map(|parent| parent.display().to_string()),
        "permissions": mode_text(&meta),
        "items": items,
        "agentsMayChange": file_access::disk::owned_by_you(&path),
    }))
}

fn read(input: &Value) -> Result<Value, String> {
    let path = admit(text(input, "path")?, Access::Read)?;
    let name = display_name(&path);
    let meta = fs_disk::metadata(&path).map_err(|error| failed(&path, error))?;
    if meta.is_dir() {
        return Err(format!("{name} is a folder: list it with files.list."));
    }
    let most = input["maxBytes"]
        .as_u64()
        .unwrap_or(READ_DEFAULT)
        .clamp(1, READ_MOST);
    let file =
        gated::open_read_for(&path, walk::WalkFor::Agent).map_err(|error| failed(&path, error))?;
    let mut bytes = Vec::new();
    file.take(most + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| failed(&path, error))?;
    let truncated = bytes.len() as u64 > most;
    bytes.truncate(most as usize);
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err(format!(
            "{name} isn't a text file: files.read reads text only."
        ));
    }
    Ok(json!({
        "path": path.display().to_string(),
        "text": String::from_utf8_lossy(&bytes),
        "truncated": truncated,
        "size": meta.len(),
    }))
}

fn reveal(app: &AppHandle, input: &Value) -> Result<Value, String> {
    let path = admit(text(input, "path")?, Access::Read)?;
    fs_disk::symlink_metadata(&path).map_err(|error| failed(&path, error))?;
    let shown = path.display().to_string();
    app.emit(REVEAL_EVENT, json!({ "path": shown }))
        .map_err(|error| error.to_string())?;
    Ok(json!({ "shown": shown }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_call_names_its_paths() {
        assert!(path_list(&json!({ "paths": [] }), "paths").is_err());
        assert_eq!(
            path_list(&json!({ "paths": [" /a ", "", 3] }), "paths").unwrap(),
            vec!["/a".to_owned()]
        );
        let many: Vec<String> = (0..=PATHS_MOST).map(|n| format!("/{n}")).collect();
        assert!(path_list(&json!({ "paths": many }), "paths").is_err());
        assert!(text(&json!({ "path": "  " }), "path").is_err());
    }

    #[test]
    fn a_call_that_did_nothing_fails() {
        let failed = [failure("/a", "No.")];
        assert!(all_failed(&[], &failed).is_err());
        assert!(all_failed(&[json!({})], &failed).is_ok());
        assert!(all_failed(&[], &[]).is_ok());
    }

    #[test]
    fn the_tools_never_delete_outright() {
        for source in [
            include_str!("agent_tools.rs"),
            include_str!("agent_tools_changes.rs"),
            include_str!("agent_tools_archive.rs"),
            include_str!("agent_trash.rs"),
        ] {
            assert!(!source.contains(&["trash", "::delete("].concat()));
        }
        assert!(include_str!("agent_tools_changes.rs").contains("move_to_trash_for_agent("));
    }
}
