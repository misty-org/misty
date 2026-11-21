//! The `files.*` tools agents use over the local MCP server: looking through the person's disk and
//! tidying it, never deleting. They run here in native code, answered by `run_control/local_tools.rs`
//! once `tool_policy.rs` has let the call through (reads run; every change asks unless the run is
//! in the engine's no-asking mode; a planning mode refuses changes). Every path passes
//! `agent_paths::admit` first, so the disk grant, Misty's data, secrets, keychains and what the
//! person's user owns are all checked again here, whatever the policy said.
//!
//! `files.trash` moves into Agent trash (`agent_trash.rs`), never the system Trash. `files.delete`
//! exists only while the person let agents delete files, and even then asks every time.
use std::{
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use file_access::{disk::fs_disk, Access};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::{admit, admit_path};
use crate::files::{
    display_name,
    entry::{entry_for, is_package_name, FileEntry, FileKind},
    failed,
};

#[path = "agent_tools_archive.rs"]
mod archive;
#[path = "agent_tools_changes.rs"]
mod changes;

/// What an engine is told about these tools, while the disk grant is on.
pub(crate) const INSTRUCTIONS: &str = "The files_* tools reach the files on this computer that \
the person let Files open, by full path (start from their home folder). They never reach Misty's \
data, keys or other secrets. Each change asks the person first unless they chose a no-asking mode. \
Never delete: to clean up, propose a plan, then move what should go into Agent trash with \
files_trash, where the person looks it over. files_reveal shows an item in the person's Files.";

/// The one tool that deletes for good, offered only while the person allows it.
pub(crate) const DELETE: &str = "files.delete";
/// What `files.reveal` sends the person's windows (`fileEvents.reveal` in `disk.ts`).
pub(crate) const REVEAL_EVENT: &str = "files://reveal";

const LIST_MOST: usize = 500;
const SEARCH_MOST: usize = 200_000;
const SEARCH_TIME: Duration = Duration::from_secs(10);
const READ_DEFAULT: u64 = 100_000;
const READ_MOST: u64 = 262_144;
/// How many paths one call may name.
const PATHS_MOST: usize = 200;

/// Whether the person's disk grant is on: without it, agents have no files tools at all.
pub(crate) fn disk_on() -> bool {
    file_access::disk::disk_allowed()
}

/// Whether a tool is offered now, by Misty's name (`files.list`) or the engine's (`files_list`).
/// Anything that isn't a files tool is left to its own rules.
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

/// Why a call did nothing, for the model.
#[derive(Debug)]
pub(crate) struct Refused {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

/// Who is asking, for Agent trash's record.
pub(super) struct Agent {
    pub(super) id: String,
    pub(super) chat: Option<String>,
}

/// Runs one admitted call.
pub(crate) async fn call(
    app: &AppHandle,
    agent_id: &str,
    chat_id: &str,
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
            message: "Agents don't delete files. Move it into Agent trash with files.trash instead. \
Nothing was deleted."
                .to_owned(),
        });
    }
    let agent = Agent {
        id: agent_id.to_owned(),
        chat: Some(chat_id.to_owned()).filter(|chat| !chat.is_empty()),
    };
    let (app, name) = (app.clone(), name.to_owned());
    tokio::task::spawn_blocking(move || run(&app, &agent, &name, &input))
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

fn run(app: &AppHandle, agent: &Agent, name: &str, input: &Value) -> Result<Value, String> {
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
        "files.trash" => changes::trash(app, agent, input),
        "files.tag" => changes::tag(input),
        "files.zip" => archive::zip(input),
        "files.extract" => archive::extract(input),
        DELETE => changes::delete(input),
        _ => Err(format!("There is no tool named {name}.")),
    }
}

// ── Reading the call ───────────────────────────────────────────────────────────────────────────

/// A text field the call must have.
pub(super) fn text<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input[key]
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| format!("Say {key}."))
}

/// An optional text field.
pub(super) fn optional<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input[key].as_str().map(str::trim).filter(|text| !text.is_empty())
}

/// The paths a call names, at least one.
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

/// One path that didn't work, in a result that lists several.
pub(super) fn failure(path: &str, error: impl std::fmt::Display) -> Value {
    json!({ "path": path, "error": error.to_string() })
}

/// When every path failed, nothing happened: the call fails, with each reason.
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

/// `name` in `folder`, or "name 2", "name 3"… when it is taken, as Finder names a copy.
pub(super) fn free_name(folder: &Path, name: &str) -> PathBuf {
    let first = folder.join(name);
    if !fs_disk::exists(&first) {
        return first;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    (2..1000)
        .map(|n| folder.join(format!("{stem} {n}{ext}")))
        .find(|candidate| !fs_disk::exists(candidate))
        .unwrap_or(first)
}

fn folders_first(entries: &mut [FileEntry]) {
    entries.sort_by_key(|entry| {
        (
            !matches!(entry.kind, FileKind::Folder),
            entry.name.to_lowercase(),
        )
    });
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────

fn list(input: &Value) -> Result<Value, String> {
    let folder = admit(text(input, "path")?, Access::Read)?;
    let hidden = input["hidden"].as_bool() == Some(true);
    let items = fs_disk::read_dir(&folder).map_err(|error| failed(&folder, error))?;
    let (mut entries, mut more) = (Vec::new(), false);
    for item in items.flatten() {
        let path = item.path();
        if !hidden && display_name(&path).starts_with('.') {
            continue;
        }
        // What agents can't open isn't named to them either.
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
            let home = home.clone().ok_or("Misty couldn't find your home folder.")?;
            admit_path(&home, Access::Read)?
        }
    };
    let limit = input["limit"].as_u64().unwrap_or(30).clamp(1, 100) as usize;
    let dotted = query.starts_with('.');
    // The home folder's Library is the system's and the apps' own: searched only when asked.
    let library = home.map(|home| home.join("Library"));
    let started = Instant::now();
    let (mut found, mut seen, mut complete) = (Vec::new(), 0usize, true);
    let mut walk = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .max_depth(16)
        .into_iter();
    while let Some(next) = walk.next() {
        let Ok(item) = next else {
            continue;
        };
        seen += 1;
        if seen > SEARCH_MOST || started.elapsed() > SEARCH_TIME {
            complete = false;
            break;
        }
        if item.depth() == 0 {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        let hidden = !dotted && name.starts_with('.');
        let lower = name.to_lowercase();
        let matches = !hidden && words.iter().all(|word| lower.contains(word));
        // Each folder is checked before the walk goes in; a file only when its name matches.
        let open = (item.file_type().is_dir() || matches)
            && file_access::disk::check_agent(item.path(), Access::Read).is_ok();
        if item.file_type().is_dir() {
            let skip = !open
                || hidden
                || name == "node_modules"
                || is_package_name(&name)
                || (cfg!(target_os = "macos") && library.as_deref() == Some(item.path()));
            if skip {
                walk.skip_current_dir();
            }
        }
        if !matches || !open {
            continue;
        }
        if let Ok(entry) = entry_for(item.path()) {
            found.push(entry);
            if found.len() >= limit {
                complete = false;
                break;
            }
        }
    }
    Ok(json!({ "folder": root.display().to_string(), "results": found, "complete": complete }))
}

#[cfg(unix)]
fn mode_text(meta: &fs_disk::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    let mode = meta.permissions().mode();
    let marks = ['r', 'w', 'x'];
    (0..9)
        .map(|bit| if mode & (1 << (8 - bit)) != 0 { marks[bit % 3] } else { '-' })
        .collect()
}

#[cfg(not(unix))]
fn mode_text(meta: &fs_disk::Metadata) -> String {
    if meta.permissions().readonly() { "Read only" } else { "Read and write" }.to_owned()
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
    let most = input["maxBytes"].as_u64().unwrap_or(READ_DEFAULT).clamp(1, READ_MOST);
    let file = fs_disk::open(&path).map_err(|error| failed(&path, error))?;
    let mut bytes = Vec::new();
    file.take(most + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| failed(&path, error))?;
    let truncated = bytes.len() as u64 > most;
    bytes.truncate(most as usize);
    if bytes.iter().take(8192).any(|byte| *byte == 0) {
        return Err(format!("{name} isn't a text file: files.read reads text only."));
    }
    Ok(json!({
        "path": path.display().to_string(),
        "text": String::from_utf8_lossy(&bytes),
        "truncated": truncated,
        "size": meta.len(),
    }))
}

/// Shows an item in the person's Files, so they see what the agent means.
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
    fn the_tools_never_name_the_system_trash() {
        for source in [
            include_str!("agent_tools.rs"),
            include_str!("agent_tools_changes.rs"),
            include_str!("agent_tools_archive.rs"),
            include_str!("agent_trash_moves.rs"),
        ] {
            for system in ["trash::delete", "trash_paths", "move_to_trash"] {
                assert!(!source.contains(&format!("{system}(")), "{system}");
            }
        }
        assert!(include_str!("agent_tools_changes.rs").contains("move_to_agent_trash("));
    }
}
