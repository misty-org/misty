use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde_json::Value;

use super::ClipboardCache;

impl ClipboardCache {
    pub fn cleanup_expired(&mut self) {
        let mut index = self.read_index();
        let now_ms = self.now_unix_ms();
        let ttl_ms = Self::DEFAULT_TTL_HOURS * 60 * 60 * 1000;
        self.cleanup_staging_files(now_ms, ttl_ms);
        let Some(entries) = index.get_mut("entries").and_then(Value::as_object_mut) else {
            return;
        };
        let mut remove = Vec::new();
        for (key, entry) in entries.iter() {
            let last_access = entry
                .get("last_access_unix_ms")
                .and_then(Value::as_i64)
                .unwrap_or_default();
            let path = entry
                .get("path")
                .and_then(Value::as_str)
                .map(PathBuf::from)
                .unwrap_or_default();
            if path.as_os_str().is_empty() || !path.exists() || last_access <= 0 {
                remove.push(key.clone());
                continue;
            }
            if now_ms.saturating_sub(last_access) <= ttl_ms {
                continue;
            }
            let is_remote_file = entry.get("type").and_then(Value::as_str) == Some("remote_file");
            if is_remote_file && !path_under_root(&self.root, &path) {
                continue;
            }
            if path_under_root(&self.root, &path) {
                if is_remote_file {
                    if let Some(parent) = path.parent() {
                        let _ = fs::remove_dir_all(parent);
                    }
                } else {
                    let _ = fs::remove_file(path);
                }
            }
            remove.push(key.clone());
        }
        if remove.is_empty() {
            return;
        }
        for key in remove {
            entries.remove(&key);
        }
        self.write_index(&index);
    }

    fn cleanup_staging_files(&self, now_ms: i64, ttl_ms: i64) {
        self.cleanup_staging_directory(&self.root.join("staging"), now_ms, ttl_ms);
        self.cleanup_staging_directory(&self.root.join("partial"), now_ms, ttl_ms);
    }

    fn cleanup_staging_directory(&self, directory: &Path, now_ms: i64, ttl_ms: i64) {
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !path_under_root(&self.root, &path) {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
                .unwrap_or_default();
            if modified_ms <= 0 || now_ms.saturating_sub(modified_ms) > ttl_ms {
                let _ = fs::remove_file(path);
            }
        }
    }
}

fn path_under_root(root: &Path, candidate: &Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let Ok(candidate) = candidate.canonicalize() else {
        return false;
    };
    candidate.starts_with(root)
}
