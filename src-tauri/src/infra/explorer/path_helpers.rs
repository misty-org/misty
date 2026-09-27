use super::*;

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
