use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

use serde_json::{json, Value};

use super::{ClipboardCache, ClipboardImageBlobCacheKey};

impl ClipboardCache {
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
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => ".jpg",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => ".png",
    }
}
