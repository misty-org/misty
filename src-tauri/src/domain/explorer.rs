use std::{
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDirectoryRequest {
    pub path: Option<String>,
    pub show_hidden: Option<bool>,
    #[serde(default)]
    pub force_remote_refresh: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateItemRequest {
    pub directory: String,
    pub name: String,
    pub kind: CreateItemKind,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreateItemKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameItemRequest {
    pub path: String,
    pub new_name: String,
    pub source_is_directory: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameItemsRequest {
    pub items: Vec<RenameItemRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItemsRequest {
    pub paths: Vec<String>,
    #[serde(default = "default_delete_permanent")]
    pub permanent: bool,
}

fn default_delete_permanent() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteItemsRequest {
    pub sources: Vec<PasteItem>,
    pub destination_directory: String,
    pub operation: ClipboardOperation,
    #[serde(default)]
    pub target_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteTextRequest {
    pub destination_directory: String,
    pub text: String,
    #[serde(default)]
    pub preferred_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteBlobRequest {
    pub destination_directory: String,
    pub bytes: Vec<u8>,
    #[serde(default)]
    pub preferred_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteItem {
    pub path: String,
    pub is_directory: bool,
    #[serde(default)]
    pub size_bytes: Option<i64>,
    #[serde(default)]
    pub remote_modified: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareOpenItemRequest {
    pub path: String,
    pub size_bytes: Option<i64>,
    pub remote_modified: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareDragItemsRequest {
    pub items: Vec<PrepareDragItemRequest>,
    pub session_id: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareDragItemRequest {
    pub path: String,
    pub is_directory: bool,
    pub size_bytes: Option<i64>,
    pub remote_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedOpenItem {
    pub local_path: String,
    pub cached: bool,
    pub source_path: Option<String>,
    pub cache_path: Option<String>,
    pub cache_hit: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDragItemsResult {
    pub items: Vec<PreparedDragItem>,
    pub skipped: Vec<PreparedDragSkippedItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDragItem {
    pub source_path: String,
    pub local_path: String,
    pub is_directory: bool,
    pub cached: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDragSkippedItem {
    pub source_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPreviewPayload {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageThumbnail {
    pub path: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardOperation {
    Copy,
    Move,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerOperationResult {
    pub affected_paths: Vec<String>,
    pub parent_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub parent_path: Option<String>,
    pub location: ExplorerLocation,
    pub entries: Vec<FileEntry>,
    pub total_count: usize,
    pub hidden_count: usize,
    pub modified_ms: Option<i64>,
    pub created_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub extension: String,
    pub mime_type: Option<String>,
    pub remote_modified: Option<String>,
    pub kind: FileKind,
    pub size_bytes: Option<u64>,
    pub modified_ms: Option<i64>,
    pub created_ms: Option<i64>,
    pub readonly: bool,
    pub hidden: bool,
    #[serde(default, rename = "isDeleted")]
    pub is_deleted: bool,
    pub location: ExplorerLocation,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerLocation {
    pub kind: ExplorerLocationKind,
    pub provider_type: Option<String>,
    pub remote_name: Option<String>,
    pub remote_path: Option<String>,
    pub peer_device_id: Option<String>,
    pub peer_root_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExplorerLocationKind {
    #[default]
    Local,
    RemoteProvider,
    Remote,
    PeerDevice,
}

impl ExplorerLocation {
    pub fn local() -> Self {
        Self::default()
    }

    pub fn peer_device(device_id: String, root_id: String, relative_path: String) -> Self {
        Self {
            kind: ExplorerLocationKind::PeerDevice,
            provider_type: None,
            remote_name: None,
            remote_path: Some(relative_path),
            peer_device_id: Some(device_id),
            peer_root_id: Some(root_id),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    Folder,
    File,
    Symlink,
    Other,
}

pub fn list_directory(
    home_dir: PathBuf,
    request: ListDirectoryRequest,
) -> ApiResult<DirectoryListing> {
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

    let metadata = fs::symlink_metadata(&path).ok();
    Ok(DirectoryListing {
        parent_path: path.parent().map(display_path),
        path: display_path(&path),
        title: None,
        location: ExplorerLocation::local(),
        entries,
        total_count,
        hidden_count,
        modified_ms: metadata
            .as_ref()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(system_time_ms),
        created_ms: metadata
            .as_ref()
            .and_then(|metadata| metadata.created().ok())
            .and_then(system_time_ms),
    })
}

pub fn create_item(request: CreateItemRequest) -> ApiResult<ExplorerOperationResult> {
    let directory = normalize_existing_dir(&request.directory)?;
    let name = validate_file_name(&request.name)?;
    let path = directory.join(name);
    if path.exists() {
        return Err(ApiError::Message(format!(
            "{} already exists.",
            display_path(&path)
        )));
    }

    match request.kind {
        CreateItemKind::File => {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|err| {
                    ApiError::Message(format!("Failed to create file {}: {err}", path.display()))
                })?;
        }
        CreateItemKind::Folder => {
            fs::create_dir(&path).map_err(|err| {
                ApiError::Message(format!("Failed to create folder {}: {err}", path.display()))
            })?;
        }
    }

    Ok(ExplorerOperationResult {
        affected_paths: vec![display_path(&path)],
        parent_path: Some(display_path(&directory)),
    })
}

pub fn rename_item(request: RenameItemRequest) -> ApiResult<ExplorerOperationResult> {
    let path = PathBuf::from(&request.path);
    if !path.exists() {
        return Err(ApiError::Message(format!(
            "{} does not exist.",
            path.display()
        )));
    }
    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| ApiError::Message("Cannot rename a filesystem root.".to_string()))?;
    let name = validate_file_name(&request.new_name)?;
    let destination = parent.join(name);
    if destination.exists() {
        return Err(ApiError::Message(format!(
            "{} already exists.",
            display_path(&destination)
        )));
    }
    fs::rename(&path, &destination).map_err(|err| {
        ApiError::Message(format!(
            "Failed to rename {} to {}: {err}",
            path.display(),
            destination.display()
        ))
    })?;

    Ok(ExplorerOperationResult {
        affected_paths: vec![display_path(&destination)],
        parent_path: Some(display_path(&parent)),
    })
}

pub fn paste_items(request: PasteItemsRequest) -> ApiResult<ExplorerOperationResult> {
    if request.sources.is_empty() {
        return Err(ApiError::Message("Copy or cut an item first.".to_string()));
    }

    let destination_directory = normalize_existing_dir(&request.destination_directory)?;
    let target_name = if request.sources.len() == 1 {
        request
            .target_name
            .as_deref()
            .map(validate_file_name)
            .transpose()?
    } else {
        None
    };
    let mut affected_paths = Vec::new();

    for raw_source in request.sources {
        let source = PathBuf::from(&raw_source.path);
        if !source.exists() {
            return Err(ApiError::Message(format!(
                "{} does not exist.",
                source.display()
            )));
        }

        let file_name = target_name
            .map(OsStr::new)
            .or_else(|| source.file_name())
            .ok_or_else(|| ApiError::Message(format!("Cannot paste {}.", source.display())))?;
        let destination = destination_directory.join(file_name);
        if destination.exists() {
            return Err(ApiError::Message(format!(
                "{} already exists.",
                display_path(&destination)
            )));
        }

        if source.is_dir() && destination_directory.starts_with(&source) {
            return Err(ApiError::Message(
                "Cannot paste a folder into itself.".to_string(),
            ));
        }

        match request.operation {
            ClipboardOperation::Copy => copy_path(&source, &destination)?,
            ClipboardOperation::Move => move_path(&source, &destination)?,
        }

        affected_paths.push(display_path(&destination));
    }

    Ok(ExplorerOperationResult {
        affected_paths,
        parent_path: Some(display_path(&destination_directory)),
    })
}

fn normalize_existing_dir(path: &str) -> ApiResult<PathBuf> {
    let path = PathBuf::from(path);
    let canonical = path.canonicalize().map_err(|err| {
        ApiError::Message(format!(
            "Failed to resolve directory {}: {err}",
            path.display()
        ))
    })?;
    if !canonical.is_dir() {
        return Err(ApiError::Message(format!(
            "{} is not a directory.",
            canonical.display()
        )));
    }
    Ok(canonical)
}

fn validate_file_name(name: &str) -> ApiResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ApiError::Message("Enter a name.".to_string()));
    }
    let path = Path::new(trimmed);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(trimmed),
        _ => Err(ApiError::Message(
            "Names cannot contain path separators.".to_string(),
        )),
    }
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
        mime_type: None,
        remote_modified: None,
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
        is_deleted: false,
        location: ExplorerLocation::local(),
    })
}

fn copy_path(source: &Path, destination: &Path) -> ApiResult<()> {
    let metadata = fs::symlink_metadata(source).map_err(|err| {
        ApiError::Message(format!("Failed to inspect {}: {err}", source.display()))
    })?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        copy_directory(source, destination)
    } else {
        fs::copy(source, destination).map_err(|err| {
            ApiError::Message(format!(
                "Failed to copy {} to {}: {err}",
                source.display(),
                destination.display()
            ))
        })?;
        Ok(())
    }
}

fn copy_directory(source: &Path, destination: &Path) -> ApiResult<()> {
    fs::create_dir(destination).map_err(|err| {
        ApiError::Message(format!(
            "Failed to create folder {}: {err}",
            destination.display()
        ))
    })?;

    for entry in fs::read_dir(source).map_err(|err| {
        ApiError::Message(format!("Failed to read folder {}: {err}", source.display()))
    })? {
        let entry = entry.map_err(|err| {
            ApiError::Message(format!("Failed to read folder {}: {err}", source.display()))
        })?;
        let child_source = entry.path();
        let child_destination = destination.join(entry.file_name());
        copy_path(&child_source, &child_destination)?;
    }

    Ok(())
}

fn move_path(source: &Path, destination: &Path) -> ApiResult<()> {
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            copy_path(source, destination)?;
            let metadata = fs::symlink_metadata(source).map_err(|err| {
                ApiError::Message(format!("Failed to inspect {}: {err}", source.display()))
            })?;
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                fs::remove_dir_all(source).map_err(|err| {
                    ApiError::Message(format!(
                        "Moved copy to {}, but failed to remove source {} after rename failed ({rename_error}): {err}",
                        destination.display(),
                        source.display()
                    ))
                })?;
            } else {
                fs::remove_file(source).map_err(|err| {
                    ApiError::Message(format!(
                        "Moved copy to {}, but failed to remove source {} after rename failed ({rename_error}): {err}",
                        destination.display(),
                        source.display()
                    ))
                })?;
            }
            Ok(())
        }
    }
}

fn system_time_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    duration.as_millis().try_into().ok()
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
