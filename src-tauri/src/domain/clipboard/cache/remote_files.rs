use std::{
    fs,
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};

use super::{staging::sanitize_file_name, ClipboardCache, ClipboardRemoteFileCacheKey};

impl ClipboardCache {
    pub fn lookup_remote_file(&mut self, key: &ClipboardRemoteFileCacheKey) -> Option<PathBuf> {
        self.cleanup_expired();
        let cache_key = Self::remote_file_key(key);
        let mut index = self.read_index();
        if let Some(path) = self.lookup_remote_file_exact(&mut index, &cache_key) {
            self.write_index(&index);
            return Some(path);
        }
        let path = self.lookup_remote_file_by_source(&mut index, key);
        if path.is_some() {
            self.write_index(&index);
        }
        path
    }

    pub fn import_remote_file_entries_from(&mut self, legacy_root: &Path) {
        if legacy_root == self.root {
            return;
        }
        let legacy_index = fs::read(legacy_root.join("index.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}));
        let Some(legacy_entries) = legacy_index.get("entries").and_then(Value::as_object) else {
            return;
        };
        let mut index = self.read_index();
        index["version"] = json!(1);
        if !index.get("entries").is_some_and(Value::is_object) {
            index["entries"] = Value::Object(Map::new());
        }
        let Some(entries) = index.get_mut("entries").and_then(Value::as_object_mut) else {
            return;
        };
        let now_ms = self.now_unix_ms();
        let mut changed = false;
        for (cache_key, legacy_entry) in legacy_entries {
            if legacy_entry.get("type").and_then(Value::as_str) != Some("remote_file") {
                continue;
            }
            let Some(path) = legacy_entry
                .get("path")
                .and_then(Value::as_str)
                .map(PathBuf::from)
            else {
                continue;
            };
            if !path.exists() {
                continue;
            }
            if entries
                .get(cache_key)
                .and_then(|entry| entry.get("path"))
                .and_then(Value::as_str)
                .map(PathBuf::from)
                .is_some_and(|existing_path| existing_path.exists())
            {
                continue;
            }
            let mut migrated = legacy_entry.clone();
            migrated["last_access_unix_ms"] = json!(now_ms);
            entries.insert(cache_key.clone(), migrated);
            changed = true;
        }
        if changed {
            self.write_index(&index);
        }
    }

    pub fn store_remote_file(
        &mut self,
        key: &ClipboardRemoteFileCacheKey,
        temp_path: &Path,
        file_name: &str,
    ) -> Result<PathBuf, String> {
        if key.is_dir {
            return Err("remote directories are not stored in the file cache".to_string());
        }
        if !temp_path.is_file() {
            return Err(format!(
                "downloaded file was not found at {}",
                temp_path.display()
            ));
        }
        self.cleanup_expired();
        let cache_key = Self::remote_file_key(key);
        let directory = self.root.join(&cache_key);
        let final_path = directory.join(sanitize_file_name(file_name));
        fs::create_dir_all(&directory)
            .map_err(|error| format!("create cache directory {}: {error}", directory.display()))?;
        let _ = fs::remove_file(&final_path);
        if fs::rename(temp_path, &final_path).is_err() {
            fs::copy(temp_path, &final_path).map_err(|error| {
                format!(
                    "copy downloaded file from {} to {}: {error}",
                    temp_path.display(),
                    final_path.display()
                )
            })?;
            fs::remove_file(temp_path).map_err(|error| {
                format!("remove temporary download {}: {error}", temp_path.display())
            })?;
        }
        self.record_remote_file_entry(&cache_key, key, &final_path);
        Ok(final_path)
    }

    pub fn store_remote_file_at_path(
        &mut self,
        key: &ClipboardRemoteFileCacheKey,
        temp_path: &Path,
        final_path: &Path,
    ) -> Result<PathBuf, String> {
        if key.is_dir {
            return Err("remote directories are not stored in the file cache".to_string());
        }
        if !temp_path.is_file() {
            return Err(format!(
                "downloaded file was not found at {}",
                temp_path.display()
            ));
        }
        self.cleanup_expired();
        let Some(directory) = final_path.parent() else {
            return Err(format!(
                "cache path has no parent: {}",
                final_path.display()
            ));
        };
        fs::create_dir_all(directory)
            .map_err(|error| format!("create cache directory {}: {error}", directory.display()))?;
        let _ = fs::remove_file(final_path);
        if fs::rename(temp_path, final_path).is_err() {
            fs::copy(temp_path, final_path).map_err(|error| {
                format!(
                    "copy downloaded file from {} to {}: {error}",
                    temp_path.display(),
                    final_path.display()
                )
            })?;
            fs::remove_file(temp_path).map_err(|error| {
                format!("remove temporary download {}: {error}", temp_path.display())
            })?;
        }
        self.record_remote_file_entry(&Self::remote_file_key(key), key, final_path);
        Ok(final_path.to_path_buf())
    }

    pub fn copy_remote_file_into_cache(
        &mut self,
        key: &ClipboardRemoteFileCacheKey,
        source_path: &Path,
        file_name: &str,
    ) -> Result<PathBuf, String> {
        if key.is_dir {
            return Err("remote directories are not stored in the file cache".to_string());
        }
        if !source_path.is_file() {
            return Err(format!(
                "downloaded file was not found at {}",
                source_path.display()
            ));
        }
        self.cleanup_expired();
        let cache_key = Self::remote_file_key(key);
        let directory = self.root.join(&cache_key);
        let final_path = directory.join(sanitize_file_name(file_name));
        fs::create_dir_all(&directory)
            .map_err(|error| format!("create cache directory {}: {error}", directory.display()))?;
        let _ = fs::remove_file(&final_path);
        fs::copy(source_path, &final_path).map_err(|error| {
            format!(
                "copy downloaded file from {} to {}: {error}",
                source_path.display(),
                final_path.display()
            )
        })?;
        self.record_remote_file_entry(&cache_key, key, &final_path);
        Ok(final_path)
    }

    pub fn copy_remote_file_to_path(
        &mut self,
        key: &ClipboardRemoteFileCacheKey,
        source_path: &Path,
        final_path: &Path,
    ) -> Result<PathBuf, String> {
        if key.is_dir {
            return Err("remote directories are not stored in the file cache".to_string());
        }
        if !source_path.is_file() {
            return Err(format!(
                "downloaded file was not found at {}",
                source_path.display()
            ));
        }
        self.cleanup_expired();
        let Some(directory) = final_path.parent() else {
            return Err(format!(
                "cache path has no parent: {}",
                final_path.display()
            ));
        };
        fs::create_dir_all(directory)
            .map_err(|error| format!("create cache directory {}: {error}", directory.display()))?;
        if source_path != final_path {
            let _ = fs::remove_file(final_path);
            fs::copy(source_path, final_path).map_err(|error| {
                format!(
                    "copy downloaded file from {} to {}: {error}",
                    source_path.display(),
                    final_path.display()
                )
            })?;
        }
        self.record_remote_file_entry(&Self::remote_file_key(key), key, final_path);
        Ok(final_path.to_path_buf())
    }

    fn lookup_remote_file_exact(&self, index: &mut Value, cache_key: &str) -> Option<PathBuf> {
        let entries = index.get_mut("entries")?.as_object_mut()?;
        let entry = entries.get_mut(cache_key)?;
        if entry.get("type").and_then(Value::as_str) != Some("remote_file") {
            return None;
        }
        let path = PathBuf::from(entry.get("path")?.as_str()?);
        if !path.exists() {
            entries.remove(cache_key);
            return None;
        }
        entry["last_access_unix_ms"] = json!(self.now_unix_ms());
        Some(path)
    }

    fn lookup_remote_file_by_source(
        &self,
        index: &mut Value,
        key: &ClipboardRemoteFileCacheKey,
    ) -> Option<PathBuf> {
        let entries = index.get_mut("entries")?.as_object_mut()?;
        let mut stale_keys = Vec::new();
        let mut matched_key = None;
        let mut matched_path = None;
        for (entry_key, entry) in entries.iter_mut() {
            if entry.get("type").and_then(Value::as_str) != Some("remote_file") {
                continue;
            }
            let Some(path) = entry.get("path").and_then(Value::as_str).map(PathBuf::from) else {
                continue;
            };
            if !path.exists() {
                stale_keys.push(entry_key.clone());
                continue;
            }
            if !remote_file_entry_matches(entry, key, &path) {
                continue;
            }
            entry["last_access_unix_ms"] = json!(self.now_unix_ms());
            entry["remote_name"] = json!(&key.remote_name);
            entry["remote_path"] = json!(&key.remote_path);
            entry["remote_size"] = json!(key.size);
            entry["remote_last_modified"] = json!(&key.last_modified);
            entry["is_dir"] = json!(key.is_dir);
            matched_key = Some(entry_key.clone());
            matched_path = Some(path);
            break;
        }
        for key in stale_keys {
            entries.remove(&key);
        }
        if let (Some(entry_key), Some(path)) = (matched_key, matched_path) {
            let entry = entries.remove(&entry_key)?;
            entries.insert(Self::remote_file_key(key), entry);
            return Some(path);
        }
        None
    }
}

fn remote_file_entry_matches(
    entry: &Value,
    key: &ClipboardRemoteFileCacheKey,
    path: &Path,
) -> bool {
    let remote_name = entry.get("remote_name").and_then(Value::as_str);
    let remote_path = entry.get("remote_path").and_then(Value::as_str);
    if remote_name.is_some() || remote_path.is_some() {
        if remote_name != Some(key.remote_name.as_str())
            || remote_path != Some(key.remote_path.as_str())
            || entry
                .get("is_dir")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                != key.is_dir
        {
            return false;
        }
        if key.size > 0
            && entry
                .get("remote_size")
                .and_then(Value::as_i64)
                .is_some_and(|size| size > 0 && size != key.size)
        {
            return false;
        }
        if !key.last_modified.trim().is_empty()
            && entry
                .get("remote_last_modified")
                .and_then(Value::as_str)
                .is_some_and(|modified| {
                    !modified.trim().is_empty() && modified != key.last_modified
                })
        {
            return false;
        }
        return true;
    }

    let Some(expected_name) = Path::new(&key.remote_path)
        .file_name()
        .and_then(|value| value.to_str())
    else {
        return false;
    };
    let Some(cached_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if cached_name != sanitize_file_name(expected_name) {
        return false;
    }
    if key.size > 0 {
        return fs::metadata(path)
            .map(|metadata| metadata.len() == key.size as u64)
            .unwrap_or(false);
    }
    true
}
