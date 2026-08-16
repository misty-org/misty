use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tokio::fs;
use uuid::Uuid;

use crate::error::{ApiError, ApiResult};

const MAX_ACCOUNT_ID_BYTES: usize = 512;
const MAX_CACHE_BYTES: usize = 48 * 1024 * 1024;

pub async fn read(cache_root: &Path, account_id: &str) -> ApiResult<Option<String>> {
    let path = cache_path(cache_root, account_id)?;
    let metadata = match fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(cache_error("inspect", &path, error)),
    };
    if metadata.len() > MAX_CACHE_BYTES as u64 {
        return Err(ApiError::Message(
            "Inbox cache is larger than the safety limit.".to_owned(),
        ));
    }
    let value = fs::read_to_string(&path)
        .await
        .map_err(|error| cache_error("read", &path, error))?;
    Ok(Some(value))
}

pub async fn write(cache_root: &Path, account_id: &str, value: &str) -> ApiResult<()> {
    if value.len() > MAX_CACHE_BYTES {
        return Err(ApiError::Message(
            "Inbox cache is larger than the safety limit.".to_owned(),
        ));
    }
    let path = cache_path(cache_root, account_id)?;
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::Message("Inbox cache path has no parent directory.".to_owned()))?;
    fs::create_dir_all(parent)
        .await
        .map_err(|error| cache_error("prepare", parent, error))?;
    set_private_directory_permissions(parent).await?;

    let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, value)
        .await
        .map_err(|error| cache_error("write", &temporary, error))?;
    set_private_file_permissions(&temporary).await?;
    if let Err(first_error) = fs::rename(&temporary, &path).await {
        if path.exists() {
            fs::remove_file(&path)
                .await
                .map_err(|error| cache_error("replace", &path, error))?;
            fs::rename(&temporary, &path)
                .await
                .map_err(|error| cache_error("activate", &path, error))?;
        } else {
            let _ = fs::remove_file(&temporary).await;
            return Err(cache_error("activate", &path, first_error));
        }
    }
    set_private_file_permissions(&path).await
}

pub async fn remove(cache_root: &Path, account_id: &str) -> ApiResult<()> {
    let path = cache_path(cache_root, account_id)?;
    match fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(cache_error("remove", &path, error)),
    }
}

fn cache_path(cache_root: &Path, account_id: &str) -> ApiResult<PathBuf> {
    let normalized = account_id.trim();
    if normalized.is_empty() || normalized.len() > MAX_ACCOUNT_ID_BYTES {
        return Err(ApiError::Message(
            "Inbox cache account is invalid.".to_owned(),
        ));
    }
    let digest = Sha256::digest(normalized.as_bytes());
    Ok(cache_root
        .join("mail")
        .join("v1")
        .join(format!("{}.json.enc", hex::encode(digest))))
}

fn cache_error(operation: &str, path: &Path, error: std::io::Error) -> ApiError {
    ApiError::Message(format!(
        "Could not {operation} Inbox cache at {}: {error}",
        path.display()
    ))
}

#[cfg(unix)]
async fn set_private_directory_permissions(path: &Path) -> ApiResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
        .await
        .map_err(|error| cache_error("secure", path, error))
}

#[cfg(not(unix))]
async fn set_private_directory_permissions(_path: &Path) -> ApiResult<()> {
    Ok(())
}

#[cfg(unix)]
async fn set_private_file_permissions(path: &Path) -> ApiResult<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .await
        .map_err(|error| cache_error("secure", path, error))
}

#[cfg(not(unix))]
async fn set_private_file_permissions(_path: &Path) -> ApiResult<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cache_is_account_isolated_and_uses_the_misty_cache_root() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "account-a", "encrypted-a")
            .await
            .unwrap();
        write(root.path(), "account-b", "encrypted-b")
            .await
            .unwrap();

        assert_eq!(
            read(root.path(), "account-a").await.unwrap().as_deref(),
            Some("encrypted-a")
        );
        assert_eq!(
            read(root.path(), "account-b").await.unwrap().as_deref(),
            Some("encrypted-b")
        );
        let path = cache_path(root.path(), "account-a").unwrap();
        assert!(path.starts_with(root.path().join("mail").join("v1")));
        assert!(!path.to_string_lossy().contains("account-a"));
    }

    #[tokio::test]
    async fn removing_a_cache_is_idempotent() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "account-a", "encrypted-a")
            .await
            .unwrap();
        remove(root.path(), "account-a").await.unwrap();
        remove(root.path(), "account-a").await.unwrap();
        assert_eq!(read(root.path(), "account-a").await.unwrap(), None);
    }
}
