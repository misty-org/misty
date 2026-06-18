use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::services::environment::AppEnvironmentService;

#[derive(Debug, Clone)]
pub struct ExplorerService {
    home_dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirectoryRequest {
    pub path: Option<String>,
    pub show_hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<FileEntry>,
    pub total_count: usize,
    pub hidden_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub extension: String,
    pub kind: FileKind,
    pub size_bytes: Option<u64>,
    pub modified_ms: Option<i64>,
    pub created_ms: Option<i64>,
    pub readonly: bool,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    Folder,
    File,
    Symlink,
    Other,
}

impl ExplorerService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            home_dir: environment.home_dir(),
        }
    }

    pub async fn list_directory(
        &self,
        request: ListDirectoryRequest,
    ) -> ApiResult<DirectoryListing> {
        let home_dir = self.home_dir.clone();
        tokio::task::spawn_blocking(move || list_directory(home_dir, request))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer worker failed: {err}")))?
    }
}

fn list_directory(home_dir: PathBuf, request: ListDirectoryRequest) -> ApiResult<DirectoryListing> {
    let requested = request
        .path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or(home_dir);
    let path = requested
        .canonicalize()
        .unwrap_or_else(|_| requested.clone());
    let show_hidden = request.show_hidden.unwrap_or(false);
    let read_dir = fs::read_dir(&path).map_err(|err| {
        ApiError::Message(format!(
            "Failed to list directory {}: {err}",
            path.display()
        ))
    })?;

    let mut entries = Vec::new();
    let mut total_count = 0usize;
    let mut hidden_count = 0usize;
    for item in read_dir {
        let item = match item {
            Ok(item) => item,
            Err(_) => continue,
        };
        total_count += 1;
        let file_name = item.file_name().to_string_lossy().to_string();
        let hidden = file_name.starts_with('.');
        if hidden {
            hidden_count += 1;
        }
        if hidden && !show_hidden {
            continue;
        }
        if let Some(entry) = file_entry(item.path(), file_name) {
            entries.push(entry);
        }
    }

    entries.sort_by(|left, right| {
        folder_rank(&left.kind)
            .cmp(&folder_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(DirectoryListing {
        parent_path: path.parent().map(display_path),
        path: display_path(&path),
        entries,
        total_count,
        hidden_count,
    })
}

fn file_entry(path: PathBuf, name: String) -> Option<FileEntry> {
    let metadata = fs::symlink_metadata(&path).ok()?;
    let file_type = metadata.file_type();
    let kind = if file_type.is_symlink() {
        FileKind::Symlink
    } else if file_type.is_dir() {
        FileKind::Folder
    } else if file_type.is_file() {
        FileKind::File
    } else {
        FileKind::Other
    };
    Some(FileEntry {
        id: display_path(&path),
        extension: path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_owned(),
        name,
        hidden: path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.starts_with('.'))
            .unwrap_or(false),
        path: display_path(&path),
        kind,
        size_bytes: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
        modified_ms: metadata.modified().ok().and_then(system_time_ms),
        created_ms: metadata.created().ok().and_then(system_time_ms),
        readonly: metadata.permissions().readonly(),
    })
}

fn system_time_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_millis().try_into().ok()?)
}

fn folder_rank(kind: &FileKind) -> u8 {
    match kind {
        FileKind::Folder => 0,
        FileKind::Symlink => 1,
        FileKind::File => 2,
        FileKind::Other => 3,
    }
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}
