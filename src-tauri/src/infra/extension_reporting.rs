use std::{
    cmp::Reverse,
    collections::HashMap,
    fs,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

use serde::Serialize;
use serde_json::Value;
use walkdir::WalkDir;

use crate::error::{ApiError, ApiResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportFile {
    path: String,
    name: String,
    bytes: u64,
    kind: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TypeRow {
    kind: String,
    bytes: u64,
    files: u64,
}

pub fn scan_storage(root: &Path, cancel: &AtomicBool) -> ApiResult<Value> {
    let root = fs::canonicalize(root)
        .map_err(|_| ApiError::Message("Selected folder does not exist.".to_owned()))?;
    if !root.is_dir() {
        return Err(ApiError::Message(
            "Storage Report requires one local folder.".to_owned(),
        ));
    }
    let mut bytes = 0_u64;
    let mut files = 0_u64;
    let mut folders = 0_u64;
    let mut skipped = 0_u64;
    let mut largest = Vec::new();
    let mut types: HashMap<String, (u64, u64)> = HashMap::new();
    for entry in WalkDir::new(&root)
        .follow_links(false)
        .same_file_system(true)
        .into_iter()
    {
        if cancel.load(Ordering::Relaxed) {
            return Err(ApiError::Message("Cancelled.".to_owned()));
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if entry.path() == root {
            continue;
        }
        if entry.file_type().is_symlink() {
            skipped += 1;
            continue;
        }
        if entry.file_type().is_dir() {
            folders += 1;
            continue;
        }
        if !entry.file_type().is_file() {
            skipped += 1;
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let len = metadata.len();
        bytes = bytes.saturating_add(len);
        files += 1;
        let kind = entry
            .path()
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .map(|value| format!(".{}", value.to_ascii_lowercase()))
            .unwrap_or_else(|| "Other".to_owned());
        let aggregate = types.entry(kind.clone()).or_insert((0, 0));
        aggregate.0 = aggregate.0.saturating_add(len);
        aggregate.1 += 1;
        largest.push(ReportFile {
            path: entry.path().display().to_string(),
            name: entry.file_name().to_string_lossy().into_owned(),
            bytes: len,
            kind,
        });
    }
    largest.sort_by_key(|file| Reverse(file.bytes));
    largest.truncate(50);
    let mut type_rows = types
        .into_iter()
        .map(|(kind, (bytes, files))| TypeRow { kind, bytes, files })
        .collect::<Vec<_>>();
    type_rows.sort_by_key(|row| Reverse(row.bytes));
    type_rows.truncate(20);
    serde_json::to_value(serde_json::json!({"root":root.display().to_string(),"bytes":bytes,"files":files,"folders":folders,"skipped":skipped,"largest":largest,"types":type_rows})).map_err(|error| ApiError::Message(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    #[test]
    fn reports_files_without_following_symlinks() {
        let root = std::env::temp_dir().join(format!("misty-report-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("folder")).unwrap();
        fs::write(root.join("folder/a.txt"), b"12345").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/", root.join("escape")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(root.parent().unwrap(), root.join("escape")).unwrap();
        let value = scan_storage(&root, &AtomicBool::new(false)).unwrap();
        assert_eq!(value["bytes"], 5);
        assert_eq!(value["files"], 1);
        assert!(value["skipped"].as_u64().unwrap() >= 1);
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn cancellation_is_observed() {
        assert!(scan_storage(Path::new("/"), &AtomicBool::new(true)).is_err());
    }
}
