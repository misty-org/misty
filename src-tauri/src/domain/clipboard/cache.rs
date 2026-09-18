use std::path::{Path, PathBuf};

use crate::infra::paths;

mod images;
mod keys;
mod maintenance;
mod remote_files;
mod staging;
mod storage;
#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClipboardRemoteFileCacheKey {
    pub remote_name: String,
    pub remote_path: String,
    pub size: i64,
    pub last_modified: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClipboardImageBlobCacheKey {
    pub blob_id: String,
    pub checksum: String,
    pub size_bytes: u64,
    pub mime_type: String,
}

pub struct ClipboardCache {
    root: PathBuf,
    now_override_ms: Option<i64>,
}

impl ClipboardCache {
    pub const DEFAULT_TTL_HOURS: i64 = 72;

    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            now_override_ms: None,
        }
    }

    pub fn default_root() -> PathBuf {
        paths::misty_home_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("tmp")
            .join("clipboard-cache")
            .join("v1")
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

impl Default for ClipboardCache {
    fn default() -> Self {
        Self::new(Self::default_root())
    }
}
