use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use sha2::{Digest as _, Sha256};

use crate::ignore::sha256_file;
use crate::model::{now_ms, ItemId, SpaceId};
use crate::store::Store;
use crate::DriveError;

pub struct Cache {
    root: PathBuf,
    holds_files: bool,
    pins: Arc<Mutex<HashMap<String, usize>>>,
}

pub struct BlobPin {
    sha256: String,
    pins: Arc<Mutex<HashMap<String, usize>>>,
}

impl Drop for BlobPin {
    fn drop(&mut self) {
        let mut pins = self
            .pins
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(count) = pins.get_mut(&self.sha256) {
            *count -= 1;
            if *count == 0 {
                pins.remove(&self.sha256);
            }
        }
    }
}

impl Cache {
    pub fn new(drive_dir: &Path, holds_files: bool) -> Self {
        Self {
            root: drive_dir.to_path_buf(),
            holds_files,
            pins: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn pin(&self, sha256: &str) -> BlobPin {
        *self
            .pins
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry(sha256.to_owned())
            .or_insert(0) += 1;
        BlobPin {
            sha256: sha256.to_owned(),
            pins: self.pins.clone(),
        }
    }

    pub fn pinned(&self, sha256: &str) -> bool {
        self.pin_guard().contains_key(sha256)
    }

    pub(crate) fn pin_guard(&self) -> MutexGuard<'_, HashMap<String, usize>> {
        self.pins
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn drop_blob(
        &self,
        store: &Store,
        sha256: &str,
        needed: impl FnOnce() -> bool,
    ) -> Result<bool, DriveError> {
        let pins = self.pin_guard();
        if pins.contains_key(sha256) || needed() {
            return Ok(false);
        }
        let _ = file_access::fs::remove_file(self.blob_path(sha256));
        store.forget_blob(sha256)?;
        drop(pins);
        Ok(true)
    }

    pub fn put_reader(
        &self,
        store: &Store,
        reader: &mut dyn Read,
        mut read: impl FnMut(u64) -> bool,
    ) -> Result<(String, u64), DriveError> {
        let temp = self.temp_path();
        if let Some(parent) = temp.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        let written = (|| -> Result<(String, u64), DriveError> {
            let mut out = file_access::fs::File::create(&temp).map_err(DriveError::io)?;
            let mut hasher = Sha256::new();
            let mut buffer = vec![0u8; 256 * 1024];
            let mut size = 0u64;
            loop {
                let count = reader.read(&mut buffer).map_err(DriveError::io)?;
                if count == 0 {
                    break;
                }
                hasher.update(&buffer[..count]);
                out.write_all(&buffer[..count]).map_err(DriveError::io)?;
                size += count as u64;
                if !read(count as u64) {
                    return Err(DriveError::Invalid("The copy was stopped.".to_owned()));
                }
            }
            out.flush().map_err(DriveError::io)?;
            Ok((hex::encode(hasher.finalize()), size))
        })();
        let (sha256, size) = match written {
            Ok(done) => done,
            Err(error) => {
                let _ = file_access::fs::remove_file(&temp);
                return Err(error);
            }
        };
        let target = self.blob_path(&sha256);
        if let Some(parent) = target.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        if file_access::fs::is_file(&target) {
            let _ = file_access::fs::remove_file(&temp);
        } else {
            file_access::fs::rename(&temp, &target).map_err(DriveError::io)?;
        }
        store.touch_blob(&sha256, size, now_ms())?;
        Ok((sha256, size))
    }

    pub fn holds_files(&self) -> bool {
        self.holds_files
    }

    pub fn blob_path(&self, sha256: &str) -> PathBuf {
        self.root.join("blobs").join(sha256)
    }

    pub fn temp_path(&self) -> PathBuf {
        self.root
            .join("tmp")
            .join(uuid::Uuid::new_v4().simple().to_string())
    }

    pub fn work_path(&self, ino: i64, handle: u64) -> PathBuf {
        self.root.join("work").join(format!("{ino}-{handle}"))
    }

    pub fn has(&self, sha256: &str) -> bool {
        file_access::fs::is_file(self.blob_path(sha256))
    }

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

    pub fn copy_in(&self, store: &Store, from: &Path) -> Result<(String, u64), DriveError> {
        let temp = self.temp_path();
        if let Some(parent) = temp.parent() {
            file_access::fs::create_dir_all(parent).map_err(DriveError::io)?;
        }
        file_access::fs::copy(from, &temp).map_err(DriveError::io)?;
        self.take(store, &temp)
    }

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
            let needed = || {
                users.iter().any(|node| {
                    node.dirty()
                        || node.not_synced
                        || open.contains(&(node.space.clone(), node.id.clone()))
                        || store.kept(&node.space, node).unwrap_or(true)
                })
            };
            if !self.drop_blob(store, &sha256, needed)? {
                continue;
            }
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
