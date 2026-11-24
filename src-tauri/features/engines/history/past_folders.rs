use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::engines::support::db::Db;

const MAX_FOLDERS: usize = 200;
const MAX_DIRS: usize = 500;
const MAX_ENTRIES: usize = 2000;
const MAX_FILES_PER_DIR: usize = 3;
const MAX_CODEX_FILES: usize = 1000;
const HEAD_BYTES: usize = 64 * 1024;
const CHUNK_BYTES: usize = 8 * 1024;
const CACHE_CAPACITY: usize = 8192;

static KNOWN: std::sync::LazyLock<parking_lot::Mutex<HashMap<PathBuf, String>>> =
    std::sync::LazyLock::new(Default::default);

fn known(key: &Path) -> Option<String> {
    KNOWN.lock().get(key).cloned()
}

fn remember(key: &Path, folder: &str) {
    let mut known = KNOWN.lock();
    if known.len() >= CACHE_CAPACITY {
        known.clear();
    }
    known.insert(key.to_path_buf(), folder.to_string());
}

#[derive(Default)]
pub(super) struct Found(HashMap<String, i64>);

impl Found {
    pub(super) fn add(&mut self, folder: &str, at_ms: i64) {
        let Some(folder) = plain_folder(folder) else {
            return;
        };
        let last = self.0.entry(folder).or_insert(at_ms);
        *last = (*last).max(at_ms);
    }

    pub(super) fn newest_first(self) -> Vec<String> {
        let mut folders: Vec<(String, i64)> = self.0.into_iter().collect();
        folders.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        folders.into_iter().map(|(folder, _)| folder).collect()
    }
}

fn plain_folder(text: &str) -> Option<String> {
    let path = Path::new(text.trim());
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return None;
    }
    let plain: PathBuf = path.components().collect();
    Some(plain.to_string_lossy().into_owned())
}

pub(super) fn register(db: &Db) {
    let protected: Vec<PathBuf> = file_access::paths::misty_root_dir().into_iter().collect();
    let home = dirs::home_dir();
    let folders: Vec<String> = find_all()
        .newest_first()
        .into_iter()
        .filter(|folder| {
            crate::agents::shared_folders::check_root(
                Path::new(folder),
                &protected,
                home.as_deref(),
            )
            .is_ok()
        })
        .take(MAX_FOLDERS)
        .collect();
    if let Err(error) = register_into(db, &folders) {
        eprintln!("[history] past chat folders weren't registered: {error}");
    }
}

pub(super) fn register_into(db: &Db, folders: &[String]) -> Result<(), String> {
    if folders.is_empty() {
        return Ok(());
    }
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let kept = std::iter::repeat_n("?", folders.len())
        .collect::<Vec<_>>()
        .join(",");
    tx.execute(
        &format!(
            "DELETE FROM cli_workspaces WHERE last_opened_at IS NULL AND path NOT IN ({kept})"
        ),
        rusqlite::params_from_iter(folders.iter()),
    )
    .map_err(|e| e.to_string())?;
    for folder in folders {
        let name = Path::new(folder)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| folder.clone());
        tx.execute(
            "INSERT INTO cli_workspaces(id, path, name) VALUES(?1, ?2, ?3)
             ON CONFLICT(path) DO NOTHING",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), folder, name],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn find_all() -> Found {
    let mut found = Found::default();
    let claude = crate::engines::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude");
    find_claude(&claude.join("projects"), &mut found);
    find_codex(&crate::engines::codex_home(), &mut found);
    let gemini = crate::engines::engine_home(Some("GEMINI_CLI_HOME"), ".gemini");
    let qwen = crate::engines::engine_home(None, ".qwen");
    for home in [gemini, qwen] {
        find_gemini_family(&home.join("tmp"), &mut found);
    }
    super::past_folders_stores::find_stores(&mut found);
    found
}

pub(super) fn modified_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|age| age.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn newest_entries(dir: &Path, folders: bool) -> Vec<(PathBuf, i64)> {
    let Ok(entries) = file_access::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<(PathBuf, i64)> = entries
        .flatten()
        .take(MAX_ENTRIES)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            (metadata.is_dir() == folders).then(|| (entry.path(), modified_ms(&metadata)))
        })
        .collect();
    out.sort_by(|a, b| b.1.cmp(&a.1));
    out
}

fn newest_files(dir: &Path, ending: &str) -> Vec<(PathBuf, i64)> {
    newest_entries(dir, false)
        .into_iter()
        .filter(|(path, _)| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(ending))
        })
        .collect()
}

pub(super) fn from_head(path: &Path, pick: impl Fn(&str) -> Option<String>) -> Option<String> {
    use std::io::Read;
    let mut reader = file_access::fs::File::open(path).ok()?;
    let mut head = Vec::new();
    let mut chunk = vec![0u8; CHUNK_BYTES];
    while head.len() < HEAD_BYTES {
        let read = reader.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        head.extend_from_slice(&chunk[..read]);
        if let Some(found) = pick(&String::from_utf8_lossy(&head)) {
            return Some(found);
        }
    }
    None
}

pub(super) fn json_paths(text: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\"");
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = text[from..].find(&needle) {
        let after = from + at + needle.len();
        from = after;
        let Some(rest) = text[after..].trim_start().strip_prefix(':') else {
            continue;
        };
        let rest = rest.trim_start();
        if !rest.starts_with('"') {
            continue;
        }
        if let Some(Ok(value)) = serde_json::Deserializer::from_str(rest)
            .into_iter::<String>()
            .next()
        {
            if Path::new(&value).is_absolute() {
                out.push(value);
            }
        }
    }
    out
}

pub(super) fn json_path(text: &str, key: &str) -> Option<String> {
    json_paths(text, key).into_iter().next()
}

pub(super) fn find_claude(projects: &Path, found: &mut Found) {
    for (dir, _) in newest_entries(projects, true).into_iter().take(MAX_DIRS) {
        let files: Vec<(PathBuf, i64)> = newest_files(&dir, ".jsonl")
            .into_iter()
            .filter(|(path, _)| path.file_stem().and_then(|stem| stem.to_str()) != Some("history"))
            .collect();
        let Some(&(_, last)) = files.first() else {
            continue;
        };
        let name = dir
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let matches = |cwd: &str| {
            super::claude_encode_project_path(cwd) == name
                || super::claude_encode_project_path(cwd.trim_end_matches(['/', '\\'])) == name
        };
        let cwd = known(&dir).or_else(|| {
            files.iter().take(MAX_FILES_PER_DIR).find_map(|(file, _)| {
                from_head(file, |head| {
                    json_paths(head, "cwd").into_iter().find(|cwd| matches(cwd))
                })
            })
        });
        if let Some(cwd) = cwd {
            remember(&dir, &cwd);
            found.add(&cwd, last);
        }
    }
}

pub(super) fn find_codex(home: &Path, found: &mut Found) {
    let mut files = Vec::new();
    for root in [home.join("sessions"), home.join("archived_sessions")] {
        newest_rollouts(&root, &mut files, 0);
    }
    for file in files {
        let Ok(metadata) = file_access::fs::metadata(&file) else {
            continue;
        };
        let cwd = known(&file).or_else(|| {
            from_head(&file, |head| {
                head.contains("\"session_meta\"")
                    .then(|| json_path(head, "cwd"))
                    .flatten()
            })
        });
        if let Some(cwd) = cwd {
            remember(&file, &cwd);
            found.add(&cwd, modified_ms(&metadata));
        }
    }
}

fn newest_rollouts(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 4 || out.len() >= MAX_CODEX_FILES {
        return;
    }
    let Ok(entries) = file_access::fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<(PathBuf, bool)> = entries
        .flatten()
        .take(MAX_ENTRIES)
        .filter_map(|entry| Some((entry.path(), entry.file_type().ok()?.is_dir())))
        .collect();
    names.sort_by(|a, b| b.0.cmp(&a.0));
    for (path, folder) in names {
        if out.len() >= MAX_CODEX_FILES {
            return;
        }
        if folder {
            newest_rollouts(&path, out, depth + 1);
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
        {
            out.push(path);
        }
    }
}

pub(super) fn find_gemini_family(tmp: &Path, found: &mut Found) {
    for (project, _) in newest_entries(tmp, true).into_iter().take(MAX_DIRS) {
        let files = newest_files(&project.join("chats"), ".jsonl");
        let Some(&(_, last)) = files.first() else {
            continue;
        };
        let cwd = known(&project).or_else(|| {
            files
                .iter()
                .take(MAX_FILES_PER_DIR)
                .find_map(|(file, _)| from_head(file, gemini_folder))
        });
        if let Some(cwd) = cwd {
            remember(&project, &cwd);
            found.add(&cwd, last);
        }
    }
}

fn gemini_folder(head: &str) -> Option<String> {
    let complete = head.rsplit_once('\n').map_or("", |(lines, _)| lines);
    complete.lines().find_map(|line| {
        let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
        let cwd = value.get("cwd").and_then(serde_json::Value::as_str);
        let first_dir = value
            .get("directories")
            .and_then(serde_json::Value::as_array)
            .and_then(|dirs| dirs.first())
            .and_then(serde_json::Value::as_str);
        cwd.or(first_dir)
            .filter(|path| Path::new(path).is_absolute())
            .map(str::to_string)
    })
}

#[cfg(test)]
#[path = "past_folders_tests.rs"]
mod tests;
