use super::*;

pub(super) fn remote_job_path(job_id: &str) -> String {
    format!("/api/remote/file/jobs/{job_id}")
}

pub(super) async fn cleanup_partial_destination_on_cancel<T>(
    destination: &Path,
    is_directory: bool,
    result: ApiResult<T>,
) -> ApiResult<T> {
    if result.as_ref().is_err_and(is_cancellation_error) {
        let _ = remove_local_path(destination, is_directory).await;
    }
    result
}

pub(super) async fn downloaded_file_exists(destination: &Path) -> bool {
    tokio::fs::metadata(destination)
        .await
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

pub(super) async fn downloaded_directory_exists(destination: &Path) -> bool {
    tokio::fs::metadata(destination)
        .await
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
}

pub(super) async fn delete_local_path_cancellable(
    path: &Path,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<()> {
    ensure_not_canceled_if(cancellation)?;
    let metadata = tokio::fs::symlink_metadata(path).await.map_err(|error| {
        ApiError::Message(format!("Failed to inspect {}: {error}", path.display()))
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        tokio::fs::remove_file(path).await.map_err(|error| {
            ApiError::Message(format!("Failed to delete file {}: {error}", path.display()))
        })?;
        return Ok(());
    }

    let mut stack = vec![(path.to_path_buf(), false)];
    while let Some((current, visited)) = stack.pop() {
        ensure_not_canceled_if(cancellation)?;
        let metadata = match tokio::fs::symlink_metadata(&current).await {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(ApiError::Message(format!(
                    "Failed to inspect {}: {error}",
                    current.display()
                )));
            }
        };
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            if visited {
                tokio::fs::remove_dir(&current).await.map_err(|error| {
                    ApiError::Message(format!(
                        "Failed to delete folder {}: {error}",
                        current.display()
                    ))
                })?;
            } else {
                stack.push((current.clone(), true));
                let mut children = tokio::fs::read_dir(&current).await.map_err(|error| {
                    ApiError::Message(format!("Failed to read {}: {error}", current.display()))
                })?;
                while let Some(child) = children.next_entry().await.map_err(|error| {
                    ApiError::Message(format!("Failed to read {}: {error}", current.display()))
                })? {
                    ensure_not_canceled_if(cancellation)?;
                    stack.push((child.path(), false));
                }
            }
        } else {
            tokio::fs::remove_file(&current).await.map_err(|error| {
                ApiError::Message(format!(
                    "Failed to delete file {}: {error}",
                    current.display()
                ))
            })?;
        }
    }
    Ok(())
}

pub(super) async fn remove_local_path(path: &Path, is_directory: bool) -> ApiResult<()> {
    let result = if is_directory {
        tokio::fs::remove_dir_all(path).await
    } else {
        tokio::fs::remove_file(path).await
    };
    result
        .map_err(|error| ApiError::Message(format!("Failed to remove {}: {error}", path.display())))
}

pub(super) async fn response_json<T>(response: StorageResponse, operation: &str) -> ApiResult<T>
where
    T: serde::de::DeserializeOwned,
{
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(ApiError::Message(if body.is_empty() {
            format!("Failed to {operation} (HTTP {})", status.as_u16())
        } else {
            body
        }));
    }
    serde_json::from_str(&body).map_err(|error| {
        ApiError::Message(format!("Failed to parse {operation} response: {error}"))
    })
}

pub(super) fn virtual_folder_entry(
    path: PathBuf,
    name: String,
    location: ExplorerLocation,
) -> FileEntry {
    FileEntry {
        id: display_path(&path),
        name: name.clone(),
        path: display_path(&path),
        extension: String::new(),
        mime_type: None,
        remote_modified: None,
        kind: FileKind::Folder,
        size_bytes: None,
        modified_ms: None,
        created_ms: None,
        readonly: false,
        hidden: name.starts_with('.'),
        is_deleted: false,
        location,
    }
}

pub(super) fn trash_virtual_entries(trash_dir: &Path) -> ApiResult<Vec<FileEntry>> {
    if !trash_dir.exists() {
        return Ok(Vec::new());
    }
    let read_dir = std::fs::read_dir(trash_dir).map_err(|err| {
        ApiError::Message(format!(
            "Failed to list trash directory {}: {err}",
            trash_dir.display()
        ))
    })?;
    let mut entries = Vec::new();
    for item in read_dir {
        let item = match item {
            Ok(item) => item,
            Err(_) => continue,
        };
        let path = item.path();
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let name = item.file_name().to_string_lossy().to_string();
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
        entries.push(FileEntry {
            id: display_path(&path),
            name: name.clone(),
            path: display_path(&path),
            extension: path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            mime_type: None,
            remote_modified: None,
            kind,
            size_bytes: if metadata.is_file() {
                Some(metadata.len())
            } else {
                None
            },
            modified_ms: metadata.modified().ok().and_then(service_system_time_ms),
            created_ms: metadata.created().ok().and_then(service_system_time_ms),
            readonly: metadata.permissions().readonly(),
            hidden: name.starts_with('.'),
            is_deleted: true,
            location: ExplorerLocation::local(),
        });
    }
    entries.sort_by(|left, right| {
        virtual_folder_rank(&left.kind)
            .cmp(&virtual_folder_rank(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

pub(super) fn service_system_time_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    duration.as_millis().try_into().ok()
}

pub(super) fn virtual_folder_rank(kind: &FileKind) -> u8 {
    match kind {
        FileKind::Folder => 0,
        FileKind::Symlink => 1,
        FileKind::File => 2,
        FileKind::Other => 3,
    }
}
