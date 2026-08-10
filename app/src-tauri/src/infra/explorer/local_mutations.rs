use super::*;

pub(super) async fn create_local_item_cancellable(
    request: CreateItemRequest,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<ExplorerOperationResult> {
    ensure_not_canceled_if(cancellation)?;
    let directory = normalize_existing_local_dir(&request.directory).await?;
    let name = validate_local_file_name(&request.name)?;
    let path = directory.join(name);
    ensure_destination_available(&path).await?;
    ensure_not_canceled_if(cancellation)?;
    let is_directory = matches!(
        request.kind,
        crate::domain::explorer::CreateItemKind::Folder
    );
    let operation = if is_directory {
        tokio::fs::create_dir(&path).await
    } else {
        tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
            .map(|_| ())
    };
    operation.map_err(|error| {
        ApiError::Message(format!(
            "Failed to create {} {}: {error}",
            if is_directory { "folder" } else { "file" },
            path.display()
        ))
    })?;
    observe_local_mutation_for_cancellation().await;
    if let Err(error) = ensure_not_canceled_if(cancellation) {
        let _ = remove_local_path(&path, is_directory).await;
        return Err(error);
    }
    Ok(ExplorerOperationResult {
        affected_paths: vec![display_path(&path)],
        parent_path: Some(display_path(&directory)),
    })
}

pub(super) async fn rename_local_item_cancellable(
    request: RenameItemRequest,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<ExplorerOperationResult> {
    ensure_not_canceled_if(cancellation)?;
    let path = PathBuf::from(&request.path);
    tokio::fs::symlink_metadata(&path).await.map_err(|error| {
        ApiError::Message(format!("Failed to inspect {}: {error}", path.display()))
    })?;
    let parent = path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| ApiError::Message("Cannot rename a filesystem root.".to_string()))?;
    let name = validate_local_file_name(&request.new_name)?;
    let destination = parent.join(name);
    ensure_destination_available(&destination).await?;
    ensure_not_canceled_if(cancellation)?;
    tokio::fs::rename(&path, &destination)
        .await
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to rename {} to {}: {error}",
                path.display(),
                destination.display()
            ))
        })?;
    observe_local_mutation_for_cancellation().await;
    if let Err(error) = ensure_not_canceled_if(cancellation) {
        let _ = tokio::fs::rename(&destination, &path).await;
        return Err(error);
    }
    Ok(ExplorerOperationResult {
        affected_paths: vec![display_path(&destination)],
        parent_path: Some(display_path(&parent)),
    })
}

#[cfg(test)]
pub(super) async fn observe_local_mutation_for_cancellation() {
    tokio::time::sleep(Duration::from_millis(10)).await;
}

#[cfg(not(test))]
pub(super) async fn observe_local_mutation_for_cancellation() {
    tokio::task::yield_now().await;
}

pub(super) async fn copy_local_path_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
) -> ApiResult<()> {
    ensure_not_canceled(cancellation)?;
    let metadata = tokio::fs::symlink_metadata(source).await.map_err(|error| {
        ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
    })?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        copy_local_directory_cancellable(source, destination, cancellation).await
    } else {
        copy_local_file_cancellable(source, destination, cancellation).await
    }
}

pub(super) async fn copy_cached_remote_file_to_destination(
    source: &Path,
    destination: &Path,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<()> {
    ensure_not_canceled_if(cancellation)?;
    tokio::fs::copy(source, destination)
        .await
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to copy cached remote file from {} to {}: {error}",
                source.display(),
                destination.display()
            ))
        })?;
    ensure_not_canceled_if(cancellation)?;
    Ok(())
}

pub(super) async fn copy_local_directory_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
) -> ApiResult<()> {
    tokio::fs::create_dir(destination).await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to create folder {}: {error}",
            destination.display()
        ))
    })?;

    let mut pending = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((current_source, current_destination)) = pending.pop() {
        ensure_not_canceled(cancellation)?;
        let mut entries = tokio::fs::read_dir(&current_source)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to read folder {}: {error}",
                    current_source.display()
                ))
            })?;
        while let Some(entry) = entries.next_entry().await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to read folder {}: {error}",
                current_source.display()
            ))
        })? {
            ensure_not_canceled(cancellation)?;
            let child_source = entry.path();
            let child_destination = current_destination.join(entry.file_name());
            let metadata = tokio::fs::symlink_metadata(&child_source)
                .await
                .map_err(|error| {
                    ApiError::Message(format!(
                        "Failed to inspect {}: {error}",
                        child_source.display()
                    ))
                })?;
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                tokio::fs::create_dir(&child_destination)
                    .await
                    .map_err(|error| {
                        ApiError::Message(format!(
                            "Failed to create folder {}: {error}",
                            child_destination.display()
                        ))
                    })?;
                pending.push((child_source, child_destination));
            } else {
                copy_local_file_cancellable(&child_source, &child_destination, cancellation)
                    .await?;
            }
        }
    }
    Ok(())
}

pub(super) async fn copy_local_file_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
) -> ApiResult<()> {
    ensure_not_canceled(cancellation)?;
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            ApiError::Message(format!("Failed to create {}: {error}", parent.display()))
        })?;
    }
    let mut input = tokio::fs::File::open(source).await.map_err(|error| {
        ApiError::Message(format!("Failed to open {}: {error}", source.display()))
    })?;
    let mut output = tokio::fs::File::create(destination)
        .await
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to create {}: {error}",
                destination.display()
            ))
        })?;
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        ensure_not_canceled(cancellation)?;
        let read = input.read(&mut buffer).await.map_err(|error| {
            ApiError::Message(format!("Failed to read {}: {error}", source.display()))
        })?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read]).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to write {}: {error}",
                destination.display()
            ))
        })?;
        tokio::task::yield_now().await;
    }
    ensure_not_canceled(cancellation)?;
    output.flush().await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to flush {}: {error}",
            destination.display()
        ))
    })?;
    Ok(())
}

pub(super) async fn move_local_path_cancellable(
    source: &Path,
    destination: &Path,
    cancellation: &AtomicBool,
) -> ApiResult<()> {
    ensure_not_canceled(cancellation)?;
    match tokio::fs::rename(source, destination).await {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            copy_local_path_cancellable(source, destination, cancellation).await?;
            ensure_not_canceled(cancellation)?;
            let metadata = tokio::fs::symlink_metadata(source).await.map_err(|error| {
                ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
            })?;
            let remove = if metadata.is_dir() && !metadata.file_type().is_symlink() {
                tokio::fs::remove_dir_all(source).await
            } else {
                tokio::fs::remove_file(source).await
            };
            remove.map_err(|error| {
                ApiError::Message(format!(
                    "Moved copy to {}, but failed to remove source {} after rename failed ({rename_error}): {error}",
                    destination.display(),
                    source.display()
                ))
            })
        }
    }
}

pub(super) async fn trash_local_path_cancellable(
    source: &Path,
    trash_dir: &Path,
    cancellation: Option<&AtomicBool>,
) -> ApiResult<PathBuf> {
    ensure_not_canceled_if(cancellation)?;
    tokio::fs::symlink_metadata(source).await.map_err(|error| {
        ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
    })?;
    if source == trash_dir {
        return Err(ApiError::Message(
            "The Misty trash directory cannot be moved to Trash.".to_string(),
        ));
    }
    tokio::fs::create_dir_all(trash_dir)
        .await
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to create trash directory {}: {error}",
                trash_dir.display()
            ))
        })?;
    let destination = available_trash_destination(trash_dir, source)?;
    let uncanceled = AtomicBool::new(false);
    let cancellation = cancellation.unwrap_or(&uncanceled);
    move_local_path_cancellable(source, &destination, cancellation).await?;
    ensure_not_canceled(cancellation)?;
    Ok(destination)
}

pub(super) fn available_trash_destination(trash_dir: &Path, source: &Path) -> ApiResult<PathBuf> {
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("item");
    let first_candidate = trash_dir.join(file_name);
    if !first_candidate.exists() {
        return Ok(first_candidate);
    }

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(file_name);
    let extension = source.extension().and_then(|value| value.to_str());
    for index in 1..10_000 {
        let name = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem} {index}.{extension}"),
            _ => format!("{stem} {index}"),
        };
        let candidate = trash_dir.join(name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(ApiError::Message(format!(
        "Could not create a unique Trash name for {}.",
        source.display()
    )))
}

pub(super) fn ensure_not_canceled(cancellation: &AtomicBool) -> ApiResult<()> {
    if cancellation.load(Ordering::SeqCst) {
        return Err(ApiError::Message("Operation canceled.".to_string()));
    }
    Ok(())
}

pub(super) fn ensure_not_canceled_if(cancellation: Option<&AtomicBool>) -> ApiResult<()> {
    if let Some(cancellation) = cancellation {
        ensure_not_canceled(cancellation)?;
    }
    Ok(())
}

pub(super) fn is_cancellation_error(error: &ApiError) -> bool {
    error
        .to_string()
        .eq_ignore_ascii_case("Operation canceled.")
}

pub(super) fn nonzero_transfer_id(transfer_id: u64) -> Option<u64> {
    if transfer_id == 0 {
        None
    } else {
        Some(transfer_id)
    }
}
