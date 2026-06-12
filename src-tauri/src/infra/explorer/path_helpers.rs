use super::*;

#[cfg(target_os = "android")]
pub(super) fn android_local_location_entry(
    location: &tauri_plugin_document_tree::DocumentTreeLocation,
) -> FileEntry {
    let path = format!(
        "{VIRTUAL_PATH_LOCAL}/{}",
        android_local_location_id(&location.uri)
    );
    FileEntry {
        id: path.clone(),
        name: location.name.clone(),
        path,
        extension: String::new(),
        mime_type: None,
        remote_modified: None,
        kind: FileKind::Folder,
        size_bytes: None,
        modified_ms: None,
        created_ms: None,
        readonly: !location.can_write,
        hidden: false,
        is_deleted: false,
        location: ExplorerLocation::local(),
    }
}

#[cfg(target_os = "android")]
pub(super) fn android_local_location_id(uri: &str) -> String {
    let digest = Sha256::digest(uri.as_bytes());
    hex::encode(&digest[..8])
}

#[cfg(target_os = "android")]
pub(super) fn parse_android_local_path(path: &str) -> ApiResult<(String, Option<String>)> {
    let remainder = path
        .strip_prefix(VIRTUAL_PATH_LOCAL)
        .and_then(|value| value.strip_prefix('/'))
        .ok_or_else(|| ApiError::Message("Invalid Android local folder path.".to_owned()))?;
    let segments = remainder
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let location_id = segments
        .first()
        .filter(|value| {
            value.len() == 16 && value.chars().all(|character| character.is_ascii_hexdigit())
        })
        .ok_or_else(|| ApiError::Message("Invalid Android local folder location.".to_owned()))?
        .to_string();
    let document_id = segments
        .last()
        .filter(|_| segments.len() > 1)
        .map(|segment| {
            URL_SAFE_NO_PAD
                .decode(segment)
                .map_err(|_| ApiError::Message("Invalid Android local folder entry.".to_owned()))
                .and_then(|bytes| {
                    String::from_utf8(bytes).map_err(|_| {
                        ApiError::Message("Invalid Android local folder entry.".to_owned())
                    })
                })
        })
        .transpose()?;
    Ok((location_id, document_id))
}

#[cfg(target_os = "android")]
pub(super) fn android_local_child_path(parent_path: &str, document_id: &str) -> String {
    format!(
        "{parent_path}/{}",
        URL_SAFE_NO_PAD.encode(document_id.as_bytes())
    )
}

pub(super) async fn local_item_size(path: &Path, is_directory: bool) -> i64 {
    if !is_directory {
        return tokio::fs::metadata(path)
            .await
            .ok()
            .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
            .unwrap_or_default();
    }

    let mut total = 0_i64;
    let mut pending = vec![path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut children = match tokio::fs::read_dir(&directory).await {
            Ok(children) => children,
            Err(_) => continue,
        };
        while let Ok(Some(child)) = children.next_entry().await {
            let child_name = child.file_name().to_string_lossy().to_string();
            if ignored_upload_name(&child_name) {
                continue;
            }
            let metadata = match child.metadata().await {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            if metadata.is_dir() {
                pending.push(child.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len().min(i64::MAX as u64) as i64);
            }
        }
    }
    total
}

pub(super) fn ignored_upload_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with('.')
        || name.starts_with("._")
        || name.starts_with("~$")
        || lower == "thumbs.db"
        || lower == "desktop.ini"
        || lower.ends_with(".swp")
        || lower.ends_with(".swo")
        || lower.ends_with(".tmp")
        || lower.ends_with(".temp")
        || lower.ends_with('~')
}

pub(super) fn remote_job_transferred_bytes(
    status: &RemoteJobStatus,
    progress: Option<TransferProgress>,
) -> i64 {
    progress
        .map(|progress| {
            progress
                .base_bytes
                .saturating_add(status.bytes_completed.max(0))
        })
        .unwrap_or(status.bytes_completed)
}

pub(super) fn remote_job_total_bytes(
    status: &RemoteJobStatus,
    progress: Option<TransferProgress>,
) -> i64 {
    progress
        .filter(|progress| progress.total_bytes > 0)
        .map(|progress| progress.total_bytes)
        .unwrap_or(status.bytes_total)
}

pub(super) fn validate_remote_name(name: &str) -> ApiResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(ApiError::Message(
            "Names cannot be empty or contain path separators.".to_string(),
        ));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(ApiError::Message("Choose a different name.".to_string()));
    }
    Ok(trimmed)
}

pub(super) fn remote_parent_path(path: &str) -> String {
    let parent = Path::new(path)
        .parent()
        .and_then(|value| value.to_str())
        .unwrap_or("/");
    if parent.is_empty() {
        "/".to_string()
    } else {
        parent.to_string()
    }
}

pub(super) fn remote_item_is_directory(
    parent: &RemoteBrowseTarget,
    target_path: &str,
    items: &[RemoteListItem],
) -> ApiResult<Option<bool>> {
    for item in items {
        if remote_item_path(parent, item)? == target_path {
            return Ok(Some(item.is_dir));
        }
    }
    Ok(None)
}

pub(super) fn is_remote_directory_not_found_error(error: &ApiError) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    message.contains("directory not found")
        || message.contains("object not found")
        || message.contains("invalidresourceid")
        || message.contains("objecthandle is invalid")
}

pub(super) fn remote_preview_metadata_from_items(
    parent: &RemoteBrowseTarget,
    target_path: &str,
    items: &[RemoteListItem],
) -> ApiResult<Option<(i64, String)>> {
    for item in items {
        if remote_item_path(parent, item)? != target_path {
            continue;
        }
        if item.is_dir {
            return Err(ApiError::Message(
                "Only files can be previewed.".to_string(),
            ));
        }
        return Ok(Some((item.size, item.mod_time.clone())));
    }
    Ok(None)
}

pub(super) fn dedupe_remote_list_items(
    parent: &RemoteBrowseTarget,
    items: Vec<RemoteListItem>,
) -> ApiResult<Vec<RemoteListItem>> {
    let mut seen_paths = BTreeSet::new();
    let mut deduped = Vec::with_capacity(items.len());
    for item in items {
        if item.name.trim().is_empty() && item.path.trim().is_empty() {
            continue;
        }
        let child_path = remote_item_path(parent, &item)?;
        if seen_paths.insert(child_path) {
            deduped.push(item);
        }
    }
    Ok(deduped)
}

pub(super) fn remote_item_path(
    parent: &RemoteBrowseTarget,
    item: &RemoteListItem,
) -> ApiResult<String> {
    let name = item.name.trim();
    if name.is_empty() {
        return parent.child_remote_path(item);
    }
    normalize_remote_path(&join_remote_path(&parent.remote_path, name))
}

pub(super) async fn ensure_destination_available(path: &Path) -> ApiResult<()> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(_) => Err(ApiError::Message(format!(
            "{} already exists.",
            path.display()
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ApiError::Message(format!(
            "Failed to inspect {}: {error}",
            path.display()
        ))),
    }
}

pub(super) async fn normalize_existing_local_dir(path: &str) -> ApiResult<PathBuf> {
    let path = PathBuf::from(path);
    let canonical = tokio::fs::canonicalize(&path).await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to resolve directory {}: {error}",
            path.display()
        ))
    })?;
    let metadata = tokio::fs::metadata(&canonical).await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to inspect {}: {error}",
            canonical.display()
        ))
    })?;
    if !metadata.is_dir() {
        return Err(ApiError::Message(format!(
            "{} is not a directory.",
            canonical.display()
        )));
    }
    Ok(canonical)
}

pub(super) fn validate_local_file_name(name: &str) -> ApiResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ApiError::Message("Enter a name.".to_string()));
    }
    let path = Path::new(trimmed);
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(_)), None) => Ok(trimmed),
        _ => Err(ApiError::Message(
            "Names cannot contain path separators.".to_string(),
        )),
    }
}
