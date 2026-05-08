use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
const MAX_WALK_ENTRIES: usize = 25_000;
const MAX_SEARCH_MATCHES: usize = 2_000;
const MAX_SEARCH_LINE_BYTES: usize = 800;

const HARD_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    ".next",
    "dist",
    "target",
    "build",
    ".venv",
    "__pycache__",
    ".DS_Store",
    ".turbo",
    ".pnpm-store",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFileContent {
    pub contents: String,
    pub size_bytes: u64,
    pub modified_ms: Option<u64>,
    pub readonly: bool,
    pub line_ending: LineEnding,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeFileMeta {
    pub size_bytes: u64,
    pub modified_ms: Option<u64>,
}

fn modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

#[tauri::command]
pub async fn code_read_text_file(path: String) -> Result<CodeFileContent, String> {
    tauri::async_runtime::spawn_blocking(move || read_text_file_blocking(path))
        .await
        .map_err(|error| error.to_string())?
}

fn read_text_file_blocking(path: String) -> Result<CodeFileContent, String> {
    let file_path = PathBuf::from(&path);
    let metadata = fs::metadata(&file_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("That path is not a file.".to_owned());
    }
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(format!(
            "File is {} bytes; Misty Code opens files up to {} bytes.",
            metadata.len(),
            MAX_TEXT_BYTES
        ));
    }
    let bytes = fs::read(&file_path).map_err(|error| error.to_string())?;
    if bytes.contains(&0) {
        return Err("File contains binary data.".to_owned());
    }
    let contents = String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8.".to_owned())?;
    let line_ending = if contents.contains("\r\n") {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };
    Ok(CodeFileContent {
        contents,
        size_bytes: metadata.len(),
        modified_ms: modified_ms(&metadata),
        readonly: metadata.permissions().readonly(),
        line_ending,
    })
}

#[tauri::command]
pub fn code_write_text_file(
    path: String,
    contents: String,
    line_ending: Option<LineEnding>,
) -> Result<CodeFileMeta, String> {
    let file_path = PathBuf::from(&path);
    let normalized = match line_ending.unwrap_or(LineEnding::Lf) {
        LineEnding::Lf => contents.replace("\r\n", "\n"),
        LineEnding::Crlf => contents.replace("\r\n", "\n").replace('\n', "\r\n"),
    };
    fs::write(&file_path, normalized.as_bytes()).map_err(|error| error.to_string())?;
    let metadata = fs::metadata(&file_path).map_err(|error| error.to_string())?;
    Ok(CodeFileMeta {
        size_bytes: metadata.len(),
        modified_ms: modified_ms(&metadata),
    })
}

#[tauri::command]
pub fn code_create_file(path: String, contents: Option<String>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if target.exists() {
        return Err("A file with that name already exists.".to_owned());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&target, contents.unwrap_or_default().as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn code_create_folder(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if target.exists() {
        return Err("A folder with that name already exists.".to_owned());
    }
    fs::create_dir_all(&target).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn code_rename_path(from: String, to: String) -> Result<(), String> {
    let source = PathBuf::from(&from);
    let dest = PathBuf::from(&to);
    if !source.exists() {
        return Err("Original path no longer exists.".to_owned());
    }
    if dest.exists() {
        return Err("A file with the new name already exists.".to_owned());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::rename(source, dest).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn code_delete_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let metadata = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(target).map_err(|error| error.to_string())
    } else {
        fs::remove_file(target).map_err(|error| error.to_string())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkedFile {
    pub path: String,
    pub relative: String,
    pub name: String,
}

fn should_skip_dir(name: &str) -> bool {
    HARD_SKIP_DIRS.contains(&name) || name.starts_with('.')
}

#[tauri::command]
pub async fn code_walk_files(root: String) -> Result<Vec<WalkedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || walk_files_blocking(root))
        .await
        .map_err(|error| error.to_string())?
}

fn walk_files_blocking(root: String) -> Result<Vec<WalkedFile>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err("Root is not a folder.".to_owned());
    }
    let mut results = Vec::new();
    for entry in WalkDir::new(&root_path)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_entry(|entry| {
            if entry.file_type().is_dir() {
                let name = entry.file_name().to_string_lossy();
                !should_skip_dir(&name)
            } else {
                true
            }
        })
    {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let relative = path
            .strip_prefix(&root_path)
            .map(|rel| rel.to_string_lossy().into_owned())
            .unwrap_or_else(|_| name.clone());
        results.push(WalkedFile {
            path: path.to_string_lossy().into_owned(),
            relative,
            name,
        });
        if results.len() >= MAX_WALK_ENTRIES {
            break;
        }
    }
    Ok(results)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub path: String,
    pub relative: String,
    pub line_number: usize,
    pub line: String,
    pub column: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
    pub used_ripgrep: bool,
}

#[tauri::command]
pub async fn code_find_in_files(
    root: String,
    query: String,
    case_sensitive: Option<bool>,
) -> Result<SearchOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        find_in_files_blocking(root, query, case_sensitive)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn find_in_files_blocking(
    root: String,
    query: String,
    case_sensitive: Option<bool>,
) -> Result<SearchOutcome, String> {
    let root_path = PathBuf::from(&root);
    if query.trim().is_empty() {
        return Ok(SearchOutcome {
            matches: Vec::new(),
            truncated: false,
            used_ripgrep: false,
        });
    }
    if !root_path.is_dir() {
        return Err("Root is not a folder.".to_owned());
    }
    if let Some(outcome) = run_ripgrep(&root_path, &query, case_sensitive.unwrap_or(false)) {
        return Ok(outcome);
    }
    Ok(run_native_search(
        &root_path,
        &query,
        case_sensitive.unwrap_or(false),
    ))
}

fn run_ripgrep(root: &Path, query: &str, case_sensitive: bool) -> Option<SearchOutcome> {
    let mut command = Command::new("rg");
    command
        .arg("--json")
        .arg("--max-count")
        .arg((MAX_SEARCH_MATCHES + 100).to_string())
        .arg("--fixed-strings")
        .arg("-e")
        .arg(query);
    if !case_sensitive {
        command.arg("-i");
    }
    command.arg("--").arg(root);
    command.stdout(Stdio::piped()).stderr(Stdio::null());

    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let reader = BufReader::new(stdout);
    let mut matches = Vec::new();
    let mut truncated = false;
    for line in reader.lines().map_while(Result::ok) {
        if let Some(parsed) = parse_rg_line(&line, root) {
            matches.push(parsed);
            if matches.len() >= MAX_SEARCH_MATCHES {
                truncated = true;
                break;
            }
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    Some(SearchOutcome {
        matches,
        truncated,
        used_ripgrep: true,
    })
}

fn parse_rg_line(line: &str, root: &Path) -> Option<SearchMatch> {
    let event: serde_json::Value = serde_json::from_str(line).ok()?;
    if event.get("type")?.as_str()? != "match" {
        return None;
    }
    let data = event.get("data")?;
    let path = data.get("path")?.get("text")?.as_str()?.to_owned();
    let line_number = data.get("line_number")?.as_u64()? as usize;
    let text = data
        .get("lines")?
        .get("text")?
        .as_str()?
        .trim_end_matches('\n');
    let submatches = data.get("submatches")?.as_array()?;
    let column = submatches
        .first()
        .and_then(|item| item.get("start"))
        .and_then(|start| start.as_u64())
        .unwrap_or(0) as usize
        + 1;
    let path_buf = PathBuf::from(&path);
    let relative = path_buf
        .strip_prefix(root)
        .map(|rel| rel.to_string_lossy().into_owned())
        .unwrap_or_else(|_| path.clone());
    Some(SearchMatch {
        path,
        relative,
        line_number,
        line: truncate_line(text),
        column,
    })
}

fn truncate_line(line: &str) -> String {
    if line.len() <= MAX_SEARCH_LINE_BYTES {
        line.to_owned()
    } else {
        format!("{}…", &line[..MAX_SEARCH_LINE_BYTES])
    }
}

fn run_native_search(root: &Path, query: &str, case_sensitive: bool) -> SearchOutcome {
    let needle = if case_sensitive {
        query.to_owned()
    } else {
        query.to_lowercase()
    };
    let mut matches = Vec::new();
    let mut truncated = false;

    'walk: for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.file_type().is_dir() {
                let name = entry.file_name().to_string_lossy();
                !should_skip_dir(&name)
            } else {
                true
            }
        })
    {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() > MAX_TEXT_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(path) else { continue };
        if bytes.contains(&0) {
            continue;
        }
        let Ok(text) = std::str::from_utf8(&bytes) else {
            continue;
        };
        for (index, line) in text.lines().enumerate() {
            let haystack = if case_sensitive {
                line.to_owned()
            } else {
                line.to_lowercase()
            };
            if let Some(column) = haystack.find(&needle) {
                let relative = path
                    .strip_prefix(root)
                    .map(|rel| rel.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| path.to_string_lossy().into_owned());
                matches.push(SearchMatch {
                    path: path.to_string_lossy().into_owned(),
                    relative,
                    line_number: index + 1,
                    line: truncate_line(line),
                    column: column + 1,
                });
                if matches.len() >= MAX_SEARCH_MATCHES {
                    truncated = true;
                    break 'walk;
                }
            }
        }
    }

    SearchOutcome {
        matches,
        truncated,
        used_ripgrep: false,
    }
}
