//! The content cache: `<drive dir>/blobs/<sha256>`, one file per content, shared by every Space of
//! the account. On Linux it is where a downloaded file lives (the FUSE face reads from it); on
//! every OS it holds content staged for upload until the server has it.
//!
//! Eviction removes the least lately used blobs until the cache is under the device's limit
//! (Settings, `misty.db`), and never one that a change not uploaded yet, Keep downloaded, or an
//! open file still needs.
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::ignore::sha256_file;
use crate::model::{now_ms, ItemId, SpaceId};
use crate::store::Store;
use crate::DriveError;

pub struct Cache {
    root: PathBuf,
    /// Whether a downloaded file's content is the blob itself (the FUSE face), so evicting the
    /// blob makes the file online-only. Elsewhere the OS keeps downloaded files on its own.
    holds_files: bool,
}

impl Cache {
    pub fn new(drive_dir: &Path, holds_files: bool) -> Self {
        Self {
            root: drive_dir.to_path_buf(),
            holds_files,
        }
    }

    pub fn holds_files(&self) -> bool {
        self.holds_files
    }

    pub fn blob_path(&self, sha256: &str) -> PathBuf {
        self.root.join("blobs").join(sha256)
    }

    /// A fresh path for a download or a write in progress, beside the blobs so a rename into
    /// place never crosses a disk.
    pub fn temp_path(&self) -> PathBuf {
        self.root
            .join("tmp")
            .join(uuid::Uuid::new_v4().simple().to_string())
    }

    /// Where an open file's writes gather until it is closed or synced (the FUSE face).
    pub fn work_path(&self, ino: i64, handle: u64) -> PathBuf {
        self.root.join("work").join(format!("{ino}-{handle}"))
    }

    pub fn has(&self, sha256: &str) -> bool {
        file_access::fs::is_file(self.blob_path(sha256))
    }

    /// Moves (or, across disks, copies) the file at `from` into the cache under its own hash.
    /// Answers the hash and size.
    pub fn take(&self, store: &Store, from: &Path) -> Result<(String, u64), DriveError> {
        let (sha256, size) = sha256_file(from, |_| ()).map_err(DriveError::io)?;
        let target = self.blob_path(&sha256);
        if let Some(parent) = target.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        if file_access::fs::is_file(&target) {
            let _ = file_access::fs::remove_file(from);
        } else if file_access::fs::rename(from, &target).is_err() {
            let temp = self.temp_path();
            if let Some(parent) = temp.parent() {
                file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
            }
            file_access::fs::copy(from, &temp).map_err(DriveError::io)?;
            file_access::fs::rename(&temp, &target).map_err(DriveError::io)?;
            let _ = file_access::fs::remove_file(from);
        }
        store.touch_blob(&sha256, size, now_ms())?;
        Ok((sha256, size))
    }

    /// Copies the file at `from` into the cache, leaving it where it is.
    pub fn copy_in(&self, store: &Store, from: &Path) -> Result<(String, u64), DriveError> {
        let temp = self.temp_path();
        if let Some(parent) = temp.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        file_access::fs::copy(from, &temp).map_err(DriveError::io)?;
        self.take(store, &temp)
    }

    /// Writes `bytes` into the cache.
    pub fn put_bytes(&self, store: &Store, bytes: &[u8]) -> Result<(String, u64), DriveError> {
        let temp = self.temp_path();
        if let Some(parent) = temp.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        file_access::fs::write(&temp, bytes).map_err(DriveError::io)?;
        self.take(store, &temp)
    }

    pub fn touch(&self, store: &Store, sha256: &str, size: u64) -> Result<(), DriveError> {
        store.touch_blob(sha256, size, now_ms())
    }

    /// Evicts until the cache holds at most `limit` bytes. `open` are the items open now.
    /// Answers the items whose content went, so the face can show them online-only.
    pub fn evict(
        &self,
        store: &Store,
        limit: u64,
        open: &HashSet<(SpaceId, ItemId)>,
    ) -> Result<Vec<(SpaceId, ItemId)>, DriveError> {
        let mut size = store.cache_size()?;
        let mut evicted = Vec::new();
        if size <= limit {
            return Ok(evicted);
        }
        for (sha256, blob_size) in store.blobs_by_age()? {
            if size <= limit {
                break;
            }
            let users = store.nodes_with_blob(&sha256)?;
            let mut needed = false;
            for node in &users {
                if node.dirty()
                    || node.not_synced
                    || open.contains(&(node.space.clone(), node.id.clone()))
                    || store.kept(&node.space, node)?
                {
                    needed = true;
                    break;
                }
            }
            if needed {
                continue;
            }
            let _ = file_access::fs::remove_file(self.blob_path(&sha256));
            store.forget_blob(&sha256)?;
            size = size.saturating_sub(blob_size);
            for mut node in users {
                if self.holds_files && node.downloaded {
                    node.downloaded = false;
                    store.update_node(&node)?;
                    evicted.push((node.space.clone(), node.id.clone()));
                }
            }
        }
        Ok(evicted)
    }

    /// Removes leftovers of downloads and writes cut short by a quit.
    pub fn sweep_temp(&self) {
        for folder in ["tmp", "work"] {
            let dir = self.root.join(folder);
            if let Ok(entries) = file_access::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let _ = file_access::fs::remove_file(entry.path());
                }
            }
        }
    }
}
