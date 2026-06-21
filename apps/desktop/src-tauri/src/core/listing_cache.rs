use std::{
    path::{Path, PathBuf},
    time::SystemTime,
};

use crate::error::{ApiError, ApiResult};

#[derive(Debug, Clone)]
pub struct ListingCache {
    root: PathBuf,
    legacy_root: PathBuf,
}

impl ListingCache {
    pub fn new(root: PathBuf, legacy_root: PathBuf) -> Self {
        Self { root, legacy_root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn file_for(&self, remote: &str, remote_path: &str) -> PathBuf {
        self.root
            .join(remote)
            .join(format!("{}.json", encode_path(remote_path)))
    }

    pub async fn load(&self, remote: &str, remote_path: &str) -> ApiResult<Option<Vec<u8>>> {
        if remote.is_empty() {
            return Ok(None);
        }
        let primary = self.file_for(remote, remote_path);
        match tokio::fs::read(&primary).await {
            Ok(bytes) if !bytes.is_empty() => return Ok(Some(bytes)),
            Ok(_) => return Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("read listing cache", &primary, error)),
        }

        let legacy = self
            .legacy_root
            .join(remote)
            .join(format!("{}.json", encode_path(remote_path)));
        match tokio::fs::read(&legacy).await {
            Ok(bytes) if !bytes.is_empty() => Ok(Some(bytes)),
            Ok(_) => Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io_error("read legacy listing cache", &legacy, error)),
        }
    }

    pub async fn save(&self, remote: &str, remote_path: &str, body: &[u8]) -> ApiResult<()> {
        if remote.is_empty() || body.is_empty() {
            return Ok(());
        }
        let path = self.file_for(remote, remote_path);
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| io_error("create listing cache", parent, error))?;
        }
        let temporary = path.with_extension("json.tmp");
        tokio::fs::write(&temporary, body)
            .await
            .map_err(|error| io_error("write listing cache", &temporary, error))?;
        if let Err(error) = tokio::fs::rename(&temporary, &path).await {
            if error.kind() != std::io::ErrorKind::AlreadyExists {
                let _ = tokio::fs::remove_file(&temporary).await;
                return Err(io_error("commit listing cache", &path, error));
            }
            let _ = tokio::fs::remove_file(&path).await;
            tokio::fs::rename(&temporary, &path)
                .await
                .map_err(|error| io_error("replace listing cache", &path, error))?;
        }
        Ok(())
    }

    pub async fn last_write_time(
        &self,
        remote: &str,
        remote_path: &str,
    ) -> ApiResult<Option<SystemTime>> {
        let primary = self.file_for(remote, remote_path);
        match tokio::fs::metadata(&primary).await {
            Ok(metadata) => Ok(metadata.modified().ok()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(io_error("inspect listing cache", &primary, error)),
        }
    }

    pub async fn clear(&self, remote: &str, remote_path: &str) -> ApiResult<()> {
        remove_if_exists(&self.file_for(remote, remote_path)).await
    }

    pub async fn clear_remote(&self, remote: &str) -> ApiResult<()> {
        if remote.is_empty() {
            return Ok(());
        }
        let path = self.root.join(remote);
        match tokio::fs::remove_dir_all(&path).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io_error("clear remote listing cache", &path, error)),
        }
    }
}

pub fn encode_path(path: &str) -> String {
    if path.is_empty() {
        return "__root__".to_string();
    }
    let mut encoded = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

async fn remove_if_exists(path: &Path) -> ApiResult<()> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_error("clear listing cache", path, error)),
    }
}

fn io_error(operation: &str, path: &Path, error: std::io::Error) -> ApiError {
    ApiError::Message(format!("Failed to {operation} {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_remote_paths_as_single_components() {
        assert_eq!(encode_path("/Documents/Work"), "%2FDocuments%2FWork");
        assert_eq!(encode_path(""), "__root__");
        assert_eq!(encode_path("safe-name_1.txt"), "safe-name_1.txt");
    }
}
