use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};

use crate::services::paths;

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
        let entry = index
            .get_mut("entries")?
            .as_object_mut()?
            .get_mut(&cache_key)?;
        if entry.get("type").and_then(Value::as_str) != Some("remote_file") {
            return None;
        }
        let path = PathBuf::from(entry.get("path")?.as_str()?);
        if !path.exists() {
            if let Some(entries) = index.get_mut("entries").and_then(Value::as_object_mut) {
                entries.remove(&cache_key);
            }
            self.write_index(&index);
            return None;
        }
        entry["last_access_unix_ms"] = json!(self.now_unix_ms());
        self.write_index(&index);
        Some(path)
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
        let directory = self.root.join("partial");
        let _ = fs::create_dir_all(&directory);
        directory.join(format!("{key}-{}.partial", sanitize_file_name(file_name)))
    }

    pub fn store_remote_file(
        &mut self,
        key: &ClipboardRemoteFileCacheKey,
        temp_path: &Path,
        file_name: &str,
    ) -> Option<PathBuf> {
        if key.is_dir {
            return None;
        }
        self.cleanup_expired();
        let cache_key = Self::remote_file_key(key);
        let directory = self.root.join("remote-files").join(&cache_key);
        let final_path = directory.join(sanitize_file_name(file_name));
        fs::create_dir_all(&directory).ok()?;
        let _ = fs::remove_file(&final_path);
        if fs::rename(temp_path, &final_path).is_err() {
            fs::copy(temp_path, &final_path).ok()?;
            let _ = fs::remove_file(temp_path);
        }
        self.record_entry(&cache_key, "remote_file", &final_path);
        Some(final_path)
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
        self.cleanup_partial_files(now_ms, ttl_ms);
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
            if path.as_os_str().is_empty()
                || !path.exists()
                || last_access <= 0
                || now_ms.saturating_sub(last_access) > ttl_ms
            {
                if path_under_root(&self.root, &path) {
                    if entry.get("type").and_then(Value::as_str) == Some("remote_file") {
                        if let Some(parent) = path.parent() {
                            let _ = fs::remove_dir_all(parent);
                        }
                    } else {
                        let _ = fs::remove_file(path);
                    }
                }
                remove.push(key.clone());
            }
        }
        if remove.is_empty() {
            return;
        }
        for key in remove {
            entries.remove(&key);
        }
        self.write_index(&index);
    }

    fn cleanup_partial_files(&self, now_ms: i64, ttl_ms: i64) {
        let partial_dir = self.root.join("partial");
        let Ok(entries) = fs::read_dir(&partial_dir) else {
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
