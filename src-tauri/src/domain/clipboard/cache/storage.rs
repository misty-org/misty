use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Map, Value};

use super::{ClipboardCache, ClipboardRemoteFileCacheKey};

impl ClipboardCache {
    pub fn set_now_for_tests(&mut self, now_unix_ms: i64) {
        self.now_override_ms = Some(now_unix_ms);
    }

    pub(super) fn record_entry(&self, cache_key: &str, kind: &str, path: &Path) {
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

    pub(super) fn record_remote_file_entry(
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

    pub(super) fn read_index(&self) -> Value {
        fs::read(self.index_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}))
    }

    pub(super) fn write_index(&self, index: &Value) {
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

    pub(super) fn now_unix_ms(&self) -> i64 {
        self.now_override_ms.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(i64::MAX as u128) as i64
        })
    }
}
