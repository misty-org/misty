// The file panel: one folder level at a time, and a file's text to read or save.

use serde::Serialize;

use super::{linked_path, person_window};

const TEXT_LIMIT: u64 = 1024 * 1024;
/// Folders that are never worth listing: they hold thousands of files nobody edits by hand.
const HEAVY: [&str; 3] = [".git", "node_modules", "target"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    /// A folder the tree shows but doesn't open by itself.
    heavy: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileText {
    /// `text`, or `binary` for a file that can't be shown as text.
    kind: &'static str,
    text: String,
    /// The file is longer than what was read; saving it would cut it short, so it opens read-only.
    truncated: bool,
}

/// What a folder holds, folders first, each group by name.
#[tauri::command]
pub async fn project_list_dir(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<Vec<Entry>, String> {
    person_window(&webview)?;
    let folder = linked_path(&app, &account, &path).await?;
    tokio::task::spawn_blocking(move || {
        let mut entries = Vec::new();
        for item in file_access::fs::read_dir(&folder).map_err(|error| error.to_string())? {
            let Ok(item) = item else { continue };
            let name = item.file_name().to_string_lossy().to_string();
            let Ok(kind) = item.file_type() else { continue };
            let is_dir = kind.is_dir();
            let size = if is_dir {
                0
            } else {
                item.metadata().map_or(0, |found| found.len())
            };
            entries.push(Entry {
                heavy: is_dir && HEAVY.contains(&name.as_str()),
                path: item.path().to_string_lossy().to_string(),
                name,
                is_dir,
                size,
            });
        }
        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// A file's text, up to a megabyte.
#[tauri::command]
pub async fn project_read_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
) -> Result<FileText, String> {
    person_window(&webview)?;
    let file = linked_path(&app, &account, &path).await?;
    tokio::task::spawn_blocking(move || {
        let size = file_access::fs::metadata(&file)
            .map_err(|error| error.to_string())?
            .len();
        let mut bytes = file_access::fs::read(&file).map_err(|error| error.to_string())?;
        let truncated = size > TEXT_LIMIT;
        bytes.truncate(TEXT_LIMIT as usize);
        // A zero byte near the start means it isn't text.
        if bytes.iter().take(8192).any(|byte| *byte == 0) {
            return Ok(FileText {
                kind: "binary",
                text: String::new(),
                truncated,
            });
        }
        Ok(FileText {
            kind: "text",
            text: String::from_utf8_lossy(&bytes).to_string(),
            truncated,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Saves a file's text.
#[tauri::command]
pub async fn project_write_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    path: String,
    content: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let file = linked_path(&app, &account, &path).await?;
    tokio::task::spawn_blocking(move || {
        file_access::fs::write(&file, content).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
