use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};

use crate::services::paths;

static PARTIAL_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

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

    pub fn remote_file_key(key: &ClipboardRemoteFileCacheKey) -> String {
        let input = format!(
            "remote-file\n{}\n{}\n{}\n{}\n{}\n",
            key.remote_name,
            key.remote_path,
            key.size,
            key.last_modified,
            i32::from(key.is_dir)
        );
        format!("{:016x}", xxh64(input.as_bytes(), 0))
    }

    pub fn image_blob_key(key: &ClipboardImageBlobCacheKey) -> String {
        let input = format!(
            "image-blob\n{}\n{}\n{}\n{}\n",
            key.blob_id, key.checksum, key.size_bytes, key.mime_type
        );
        format!("{:016x}", xxh64(input.as_bytes(), 0))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

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

    pub fn lookup_image_blob(&mut self, key: &ClipboardImageBlobCacheKey) -> Option<Vec<u8>> {
        self.cleanup_expired();
        let cache_key = Self::image_blob_key(key);
        let mut index = self.read_index();
        let entry = index
            .get_mut("entries")?
            .as_object_mut()?
            .get_mut(&cache_key)?;
        if entry.get("type").and_then(Value::as_str) != Some("image_blob") {
            return None;
        }
        let path = PathBuf::from(entry.get("path")?.as_str()?);
        let mut bytes = Vec::new();
        fs::File::open(&path).ok()?.read_to_end(&mut bytes).ok()?;
        if bytes.is_empty() {
            return None;
        }
        entry["last_access_unix_ms"] = json!(self.now_unix_ms());
        self.write_index(&index);
        Some(bytes)
    }

    pub fn temp_path_for(&self, key: &str, file_name: &str) -> PathBuf {
        let directory = self.root.join("staging");
        let _ = fs::create_dir_all(&directory);
        let unique = PARTIAL_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        directory.join(format!(
            "{key}.{:x}.{}.{}-{}",
            self.now_unix_ms(),
            std::process::id(),
            unique,
            sanitize_file_name(file_name)
        ))
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

    pub fn store_image_blob(&mut self, key: &ClipboardImageBlobCacheKey, bytes: &[u8]) -> bool {
        if bytes.is_empty() {
            return false;
        }
        self.cleanup_expired();
        let cache_key = Self::image_blob_key(key);
        let directory = self.root.join("image-blobs");
        let final_path =
            directory.join(format!("{cache_key}{}", extension_for_mime(&key.mime_type)));
        let temp_path = directory.join(format!("{cache_key}.partial"));
        if fs::create_dir_all(&directory).is_err() {
            return false;
        }
        let wrote = fs::File::create(&temp_path)
            .and_then(|mut file| file.write_all(bytes))
            .is_ok();
        if !wrote {
            return false;
        }
        let _ = fs::remove_file(&final_path);
        if fs::rename(&temp_path, &final_path).is_err() {
            let _ = fs::remove_file(&temp_path);
            return false;
        }
        self.record_entry(&cache_key, "image_blob", &final_path);
        true
    }

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

    pub fn set_now_for_tests(&mut self, now_unix_ms: i64) {
        self.now_override_ms = Some(now_unix_ms);
    }

    fn record_entry(&self, cache_key: &str, kind: &str, path: &Path) {
        let mut index = self.read_index();
        index["version"] = json!(1);
        if !index.get("entries").is_some_and(Value::is_object) {
            index["entries"] = Value::Object(Map::new());
        }
        let now_ms = self.now_unix_ms();
        index["entries"][cache_key] = json!({
            "type": kind,
            "path": path.to_string_lossy(),
            "created_unix_ms": now_ms,
            "last_access_unix_ms": now_ms,
            "ttl_hours": Self::DEFAULT_TTL_HOURS,
        });
        self.write_index(&index);
    }

    fn record_remote_file_entry(
        &self,
        cache_key: &str,
        key: &ClipboardRemoteFileCacheKey,
        path: &Path,
    ) {
        let mut index = self.read_index();
        index["version"] = json!(1);
        if !index.get("entries").is_some_and(Value::is_object) {
            index["entries"] = Value::Object(Map::new());
        }
        let now_ms = self.now_unix_ms();
        index["entries"][cache_key] = json!({
            "type": "remote_file",
            "path": path.display().to_string(),
            "created_unix_ms": now_ms,
            "last_access_unix_ms": now_ms,
            "ttl_hours": Self::DEFAULT_TTL_HOURS,
            "remote_name": &key.remote_name,
            "remote_path": &key.remote_path,
            "remote_size": key.size,
            "remote_last_modified": &key.last_modified,
            "is_dir": key.is_dir,
        });
        self.write_index(&index);
    }

    fn index_path(&self) -> PathBuf {
        self.root.join("index.json")
    }

    fn read_index(&self) -> Value {
        fs::read(self.index_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}))
    }

    fn write_index(&self, index: &Value) {
        let path = self.index_path();
        let Some(parent) = path.parent() else {
            return;
        };
        if fs::create_dir_all(parent).is_err() {
            return;
        }
        let temp = path.with_extension("json.tmp");
        let Ok(body) = serde_json::to_vec_pretty(index) else {
            return;
        };
        if fs::write(&temp, body).is_err() {
            return;
        }
        if fs::rename(&temp, &path).is_err() {
            let _ = fs::remove_file(&path);
            let _ = fs::rename(&temp, &path);
        }
    }

    fn now_unix_ms(&self) -> i64 {
        self.now_override_ms.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(i64::MAX as u128) as i64
        })
    }
}

impl Default for ClipboardCache {
    fn default() -> Self {
        Self::new(Self::default_root())
    }
}

fn sanitize_file_name(name: &str) -> String {
    if name.is_empty() || name == "." || name == ".." {
        return "clipboard-item".to_string();
    }
    name.chars()
        .map(|character| {
            if matches!(character, '/' | '\\' | ':' | '\0') {
                '_'
            } else {
                character
            }
        })
        .collect()
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".png",
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

fn xxh64(input: &[u8], seed: u64) -> u64 {
    const PRIME1: u64 = 11_400_714_785_074_694_791;
    const PRIME2: u64 = 14_029_467_366_897_019_727;
    const PRIME3: u64 = 1_609_587_929_392_839_161;
    const PRIME4: u64 = 9_650_029_242_287_828_579;
    const PRIME5: u64 = 2_870_177_450_012_600_261;

    fn round(mut accumulator: u64, lane: u64) -> u64 {
        const PRIME1: u64 = 11_400_714_785_074_694_791;
        const PRIME2: u64 = 14_029_467_366_897_019_727;
        accumulator = accumulator.wrapping_add(lane.wrapping_mul(PRIME2));
        accumulator = accumulator.rotate_left(31);
        accumulator.wrapping_mul(PRIME1)
    }

    fn merge_round(mut accumulator: u64, value: u64) -> u64 {
        const PRIME1: u64 = 11_400_714_785_074_694_791;
        const PRIME4: u64 = 9_650_029_242_287_828_579;
        accumulator ^= round(0, value);
        accumulator = accumulator.wrapping_mul(PRIME1).wrapping_add(PRIME4);
        accumulator
    }

    let mut offset = 0usize;
    let mut hash = if input.len() >= 32 {
        let mut v1 = seed.wrapping_add(PRIME1).wrapping_add(PRIME2);
        let mut v2 = seed.wrapping_add(PRIME2);
        let mut v3 = seed;
        let mut v4 = seed.wrapping_sub(PRIME1);
        while offset <= input.len() - 32 {
            v1 = round(
                v1,
                u64::from_le_bytes(input[offset..offset + 8].try_into().unwrap()),
            );
            v2 = round(
                v2,
                u64::from_le_bytes(input[offset + 8..offset + 16].try_into().unwrap()),
            );
            v3 = round(
                v3,
                u64::from_le_bytes(input[offset + 16..offset + 24].try_into().unwrap()),
            );
            v4 = round(
                v4,
                u64::from_le_bytes(input[offset + 24..offset + 32].try_into().unwrap()),
            );
            offset += 32;
        }
        let mut hash = v1
            .rotate_left(1)
            .wrapping_add(v2.rotate_left(7))
            .wrapping_add(v3.rotate_left(12))
            .wrapping_add(v4.rotate_left(18));
        hash = merge_round(hash, v1);
        hash = merge_round(hash, v2);
        hash = merge_round(hash, v3);
        merge_round(hash, v4)
    } else {
        seed.wrapping_add(PRIME5)
    };

    hash = hash.wrapping_add(input.len() as u64);
    while offset + 8 <= input.len() {
        let lane = u64::from_le_bytes(input[offset..offset + 8].try_into().unwrap());
        hash ^= round(0, lane);
        hash = hash
            .rotate_left(27)
            .wrapping_mul(PRIME1)
            .wrapping_add(PRIME4);
        offset += 8;
    }
    if offset + 4 <= input.len() {
        let lane = u32::from_le_bytes(input[offset..offset + 4].try_into().unwrap()) as u64;
        hash ^= lane.wrapping_mul(PRIME1);
        hash = hash
            .rotate_left(23)
            .wrapping_mul(PRIME2)
            .wrapping_add(PRIME3);
        offset += 4;
    }
    while offset < input.len() {
        hash ^= (input[offset] as u64).wrapping_mul(PRIME5);
        hash = hash.rotate_left(11).wrapping_mul(PRIME1);
        offset += 1;
    }
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(PRIME2);
    hash ^= hash >> 29;
    hash = hash.wrapping_mul(PRIME3);
    hash ^ (hash >> 32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "misty-clipboard-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn remote_key(path: &str) -> ClipboardRemoteFileCacheKey {
        ClipboardRemoteFileCacheKey {
            remote_name: "dropbox-mattdev727".into(),
            remote_path: path.into(),
            size: 42,
            last_modified: "2026-06-13T01:02:03Z".into(),
            is_dir: false,
        }
    }

    #[test]
    fn xxhash64_matches_reference_vector() {
        assert_eq!(xxh64(b"", 0), 0xef46db3751d8e999);
    }

    #[test]
    fn remote_file_miss_store_and_hit() {
        let root = root("remote");
        let mut cache = ClipboardCache::new(root.clone());
        let key = remote_key("Projects/List.h");
        let temp = cache.temp_path_for(&ClipboardCache::remote_file_key(&key), "List.h");
        fs::write(&temp, b"payload").expect("write partial cache file");
        let stored = cache
            .store_remote_file(&key, &temp, "List.h")
            .expect("store remote cache file");
        assert_eq!(cache.lookup_remote_file(&key), Some(stored));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn downloaded_remote_file_is_copied_into_cache() {
        let root = root("remote-copy");
        let mut cache = ClipboardCache::new(root.clone());
        let key = remote_key("Projects/List.h");
        let downloaded = root.join("Downloads").join("List.h");
        fs::create_dir_all(downloaded.parent().unwrap()).expect("create downloads dir");
        fs::write(&downloaded, b"downloaded payload").expect("write downloaded file");

        let stored = cache
            .copy_remote_file_into_cache(&key, &downloaded, "List.h")
            .expect("copy downloaded file into cache");

        assert!(downloaded.exists());
        assert_eq!(
            fs::read(&stored).expect("read cached file"),
            b"downloaded payload",
        );
        assert_eq!(cache.lookup_remote_file(&key), Some(stored));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_file_cache_imports_legacy_remote_open_entries() {
        let root = root("remote-import");
        let legacy_root = root.join("remote-open").join("v1");
        let current_root = root.join("remote-files").join("v1");
        let key = remote_key("Projects/List.h");
        let cache_key = ClipboardCache::remote_file_key(&key);
        let legacy_file = legacy_root
            .join("remote-files")
            .join(&cache_key)
            .join("List.h");
        fs::create_dir_all(legacy_file.parent().unwrap()).expect("create legacy cache dir");
        fs::write(&legacy_file, b"legacy payload").expect("write legacy file");
        fs::create_dir_all(&legacy_root).expect("create legacy root");
        fs::write(
            legacy_root.join("index.json"),
            serde_json::to_vec_pretty(&json!({
                "version": 1,
                "entries": {
                    cache_key: {
                        "type": "remote_file",
                        "path": legacy_file.display().to_string(),
                        "created_unix_ms": 1,
                        "last_access_unix_ms": 1,
                        "ttl_hours": ClipboardCache::DEFAULT_TTL_HOURS,
                        "remote_name": key.remote_name,
                        "remote_path": key.remote_path,
                        "remote_size": key.size,
                        "remote_last_modified": key.last_modified,
                        "is_dir": key.is_dir,
                    }
                }
            }))
            .unwrap(),
        )
        .expect("write legacy index");

        let mut cache = ClipboardCache::new(current_root.clone());
        cache.import_remote_file_entries_from(&legacy_root);

        assert_eq!(
            cache.lookup_remote_file(&remote_key("Projects/List.h")),
            Some(legacy_file)
        );
        assert!(current_root.join("index.json").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_file_cache_imports_metadata_light_legacy_entries() {
        let root = root("remote-import-light");
        let legacy_root = root.join("remote-open").join("v1");
        let current_root = root.join("remote-files").join("v1");
        let legacy_file = legacy_root
            .join("remote-files")
            .join("legacy-key")
            .join("List.h");
        fs::create_dir_all(legacy_file.parent().unwrap()).expect("create legacy cache dir");
        fs::write(&legacy_file, vec![0; 42]).expect("write legacy file");
        fs::create_dir_all(&legacy_root).expect("create legacy root");
        fs::write(
            legacy_root.join("index.json"),
            serde_json::to_vec_pretty(&json!({
                "version": 1,
                "entries": {
                    "legacy-key": {
                        "type": "remote_file",
                        "path": legacy_file.display().to_string(),
                        "created_unix_ms": 1,
                        "last_access_unix_ms": 1,
                        "ttl_hours": ClipboardCache::DEFAULT_TTL_HOURS,
                    }
                }
            }))
            .unwrap(),
        )
        .expect("write legacy index");

        let mut cache = ClipboardCache::new(current_root);
        cache.import_remote_file_entries_from(&legacy_root);

        assert_eq!(
            cache.lookup_remote_file(&remote_key("Projects/List.h")),
            Some(legacy_file)
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_file_can_be_stored_at_mounted_route() {
        let cache_root = root("remote-mounted-route-cache");
        let mount_root = root("remote-mounted-route-mnt");
        let mut cache = ClipboardCache::new(cache_root.clone());
        let key = remote_key("Projects/List.h");
        let temp = cache.temp_path_for(&ClipboardCache::remote_file_key(&key), "List.h");
        let mounted_file = mount_root
            .join("mattdev727")
            .join("Projects")
            .join("List.h");
        fs::write(&temp, b"mounted route payload").expect("write staging file");

        let stored = cache
            .store_remote_file_at_path(&key, &temp, &mounted_file)
            .expect("store remote file at mounted path");

        assert_eq!(stored, mounted_file);
        assert!(!temp.exists());
        assert_eq!(
            fs::read(&stored).expect("read mounted cached file"),
            b"mounted route payload",
        );
        assert_eq!(cache.lookup_remote_file(&key), Some(stored.clone()));
        let _ = fs::remove_dir_all(cache_root);
        let _ = fs::remove_dir_all(mount_root);
    }

    #[test]
    fn mounted_route_cache_entry_persists_while_visible_file_exists() {
        let cache_root = root("remote-mounted-expiry-cache");
        let mount_root = root("remote-mounted-expiry-mnt");
        let mut cache = ClipboardCache::new(cache_root.clone());
        let key = remote_key("Projects/List.h");
        let mounted_file = mount_root
            .join("mattdev727")
            .join("Projects")
            .join("List.h");
        fs::create_dir_all(mounted_file.parent().unwrap()).expect("create mounted parent");
        fs::write(&mounted_file, b"visible payload").expect("write mounted file");
        cache.set_now_for_tests(1000 * 60 * 60 * 1000);
        cache
            .copy_remote_file_to_path(&key, &mounted_file, &mounted_file)
            .expect("record mounted cache entry");

        cache.set_now_for_tests(1000 * 60 * 60 * 1000 + 73 * 60 * 60 * 1000);
        cache.cleanup_expired();

        assert!(mounted_file.exists());
        assert_eq!(cache.lookup_remote_file(&key), Some(mounted_file.clone()));
        let _ = fs::remove_dir_all(cache_root);
        let _ = fs::remove_dir_all(mount_root);
    }

    #[test]
    fn remote_file_lookup_reuses_legacy_cache_entry_for_same_file() {
        let root = root("remote-legacy");
        let mut cache = ClipboardCache::new(root.clone());
        let stored = root
            .join("remote-files")
            .join("legacy-key")
            .join("Melissa Chen_Ryman Arts.jpg");
        fs::create_dir_all(stored.parent().unwrap()).expect("create legacy cache directory");
        fs::write(&stored, b"legacy image payload").expect("write legacy cache file");
        cache.record_entry("legacy-key", "remote_file", &stored);

        let mut key = remote_key("Photos/Melissa Chen_Ryman Arts.jpg");
        key.size = b"legacy image payload".len() as i64;
        key.last_modified = "2026-06-26T01:02:03Z".into();

        assert_eq!(cache.lookup_remote_file(&key), Some(stored.clone()));
        assert_eq!(cache.lookup_remote_file(&key), Some(stored));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_file_lookup_rejects_stale_source_metadata() {
        let root = root("remote-stale-source");
        let mut cache = ClipboardCache::new(root.clone());
        let key = remote_key("Projects/List.h");
        let temp = cache.temp_path_for(&ClipboardCache::remote_file_key(&key), "List.h");
        fs::write(&temp, b"payload").expect("write staging file");
        cache
            .store_remote_file(&key, &temp, "List.h")
            .expect("store remote cache file");

        let mut changed = key.clone();
        changed.size = 9001;

        assert_eq!(cache.lookup_remote_file(&changed), None);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn temp_paths_are_unique_for_parallel_downloads() {
        let root = root("unique-partial");
        let mut cache = ClipboardCache::new(root.clone());
        cache.set_now_for_tests(1_800_000_000_000);
        let cache_key = ClipboardCache::remote_file_key(&remote_key("Photos/IMG_0481.jpeg"));

        let first = cache.temp_path_for(&cache_key, "IMG_0481.jpeg"); // gitleaks:allow -- test filename
        let second = cache.temp_path_for(&cache_key, "IMG_0481.jpeg"); // gitleaks:allow -- test filename

        assert_ne!(first, second);
        assert_eq!(first.parent(), second.parent());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn image_blob_miss_store_and_hit() {
        let root = root("image");
        let mut cache = ClipboardCache::new(root.clone());
        let key = ClipboardImageBlobCacheKey {
            blob_id: "blob-123".into(),
            checksum: "sha256:abc".into(),
            size_bytes: 4,
            mime_type: "image/png".into(),
        };
        assert!(cache.store_image_blob(&key, &[1, 2, 3, 4]));
        assert_eq!(cache.lookup_image_blob(&key), Some(vec![1, 2, 3, 4]));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_expires_only_stale_entries() {
        let root = root("ttl");
        let mut cache = ClipboardCache::new(root.clone());
        let fresh = remote_key("Projects/List.h");
        let expired = remote_key("Projects/Old.h");
        let base = 1000 * 60 * 60 * 1000;
        cache.set_now_for_tests(base);
        for (key, name) in [(&fresh, "List.h"), (&expired, "Old.h")] {
            let temp = cache.temp_path_for(&ClipboardCache::remote_file_key(key), name);
            fs::write(&temp, name).expect("write partial cache file");
            cache
                .store_remote_file(key, &temp, name)
                .expect("store cache file");
        }
        cache.set_now_for_tests(base + 2 * 60 * 60 * 1000);
        assert!(cache.lookup_remote_file(&fresh).is_some());
        cache.set_now_for_tests(base + 73 * 60 * 60 * 1000);
        cache.cleanup_expired();
        assert!(cache.lookup_remote_file(&expired).is_none());
        assert!(cache.lookup_remote_file(&fresh).is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_removes_stale_partial_files_without_index() {
        let root = root("partial");
        let mut cache = ClipboardCache::new(root.clone());
        let partial = cache.temp_path_for("stale-key", "download.bin");
        fs::write(&partial, b"partial").expect("write partial file");

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(i64::MAX as u128) as i64;
        cache.set_now_for_tests(now_ms + 73 * 60 * 60 * 1000);
        cache.cleanup_expired();

        assert!(!partial.exists());
        let _ = fs::remove_dir_all(root);
    }
}
