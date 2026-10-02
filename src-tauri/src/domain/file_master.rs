use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBrowseTarget {
    pub provider_type: String,
    pub remote_name: String,
    pub remote_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RemoteListItem {
    #[serde(default, alias = "Name")]
    pub name: String,
    #[serde(default, alias = "Path")]
    pub path: String,
    #[serde(default, alias = "IsDir")]
    pub is_dir: bool,
    #[serde(default, alias = "Size")]
    pub size: i64,
    #[serde(default, alias = "ModTime")]
    pub mod_time: String,
    #[serde(default, alias = "MimeType")]
    pub mime_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RemoteJobStart {
    pub job_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
pub struct RemoteJobStatus {
    #[serde(default, alias = "id")]
    pub job_id: String,
    #[serde(default)]
    pub operation: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub bytes_completed: i64,
    #[serde(default)]
    pub bytes_total: i64,
    #[serde(default)]
    pub bytes_per_second: f64,
    #[serde(default)]
    pub source_remote: String,
    #[serde(default)]
    pub source_path: String,
    #[serde(default)]
    pub dest_remote: String,
    #[serde(default)]
    pub dest_path: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub result_ready: bool,
    #[serde(default)]
    pub result_kind: String,
}

impl RemoteBrowseTarget {
    pub fn virtual_path(&self, mount_root: &Path) -> PathBuf {
        let mut path = mount_root.join(&self.remote_name);
        for part in self.remote_path.trim_start_matches('/').split('/') {
            if !part.is_empty() {
                path.push(part);
            }
        }
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_native_backend_list_item_fields() {
        let item: RemoteListItem = serde_json::from_value(serde_json::json!({
            "Name": "Photos",
            "Path": "Photos",
            "IsDir": true,
            "Size": -1,
            "ModTime": "2026-07-16T10:00:00Z",
            "MimeType": "inode/directory"
        }))
        .expect("native backend list item");

        assert_eq!(item.name, "Photos");
        assert_eq!(item.path, "Photos");
        assert!(item.is_dir);
        assert_eq!(item.size, -1);
        assert_eq!(item.mod_time, "2026-07-16T10:00:00Z");
        assert_eq!(item.mime_type, "inode/directory");
    }
}
