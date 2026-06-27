use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBrowseTarget {
    pub provider_type: String,
    pub remote_name: String,
    pub remote_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RemoteListItem {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub is_dir: bool,
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub mod_time: String,
    #[serde(default)]
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
    pub fn from_virtual_path(mount_root: &Path, path: &Path) -> Option<Self> {
        let relative = path.strip_prefix(mount_root).ok()?;
        let parts = normal_components(relative)?;
        if parts.is_empty() {
            return None;
        }

        let remote_path = if parts.len() == 1 {
            "/".to_string()
        } else {
            format!("/{}", parts[1..].join("/"))
        };
        Some(Self {
            provider_type: String::new(),
            remote_name: parts[0].clone(),
            remote_path,
        })
    }

    pub fn virtual_path(&self, mount_root: &Path) -> PathBuf {
        let mut path = mount_root.join(&self.remote_name);
        for part in self.remote_path.trim_start_matches('/').split('/') {
            if !part.is_empty() {
                path.push(part);
            }
        }
        path
    }

    pub fn child_remote_path(&self, item: &RemoteListItem) -> ApiResult<String> {
        let raw = if item.path.trim().is_empty() {
            join_remote_path(&self.remote_path, &item.name)
        } else {
            let item_path = normalize_remote_path(&item.path)?;
            let base = normalize_remote_path(&self.remote_path)?;
            if base == "/" || item_path == base || item_path.starts_with(&(base + "/")) {
                item_path
            } else {
                join_remote_path(&self.remote_path, item_path.trim_start_matches('/'))
            }
        };
        normalize_remote_path(&raw)
    }
}

pub fn virtual_path_parts(mount_root: &Path, path: &Path) -> Option<Vec<String>> {
    let relative = path.strip_prefix(mount_root).ok()?;
    normal_components(relative)
}

pub fn normalize_remote_path(value: &str) -> ApiResult<String> {
    let parts = normal_components(Path::new(value)).ok_or_else(|| {
        ApiError::Message(format!("Remote path contains invalid traversal: {value}"))
    })?;
    if parts.is_empty() {
        Ok("/".to_string())
    } else {
        Ok(format!("/{}", parts.join("/")))
    }
}

pub fn join_remote_path(parent: &str, child: &str) -> String {
    let parent = parent.trim_matches('/');
    let child = child.trim_matches('/');
    match (parent.is_empty(), child.is_empty()) {
        (true, true) => "/".to_string(),
        (true, false) => format!("/{child}"),
        (false, true) => format!("/{parent}"),
        (false, false) => format!("/{parent}/{child}"),
    }
}

fn normal_components(path: &Path) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => parts.push(value.to_string_lossy().to_string()),
            Component::RootDir | Component::CurDir => {}
            Component::Prefix(_) | Component::ParentDir => return None,
        }
    }
    Some(parts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remote_virtual_paths() {
        let root = Path::new("/Users/test/.misty/mnt");
        let target = RemoteBrowseTarget::from_virtual_path(
            root,
            Path::new("/Users/test/.misty/mnt/work/Documents/Reports"),
        )
        .expect("remote path");
        assert_eq!(target.provider_type, "");
        assert_eq!(target.remote_name, "work");
        assert_eq!(target.remote_path, "/Documents/Reports");
    }

    #[test]
    fn rejects_remote_path_traversal() {
        assert!(normalize_remote_path("/Documents/../Secrets").is_err());
    }

    #[test]
    fn joins_relative_list_results_to_the_browsed_directory() {
        let target = RemoteBrowseTarget {
            provider_type: "drive".into(),
            remote_name: "work".into(),
            remote_path: "/Documents".into(),
        };
        let item = RemoteListItem {
            name: "report.pdf".into(),
            path: "report.pdf".into(),
            is_dir: false,
            size: 12,
            mod_time: String::new(),
            mime_type: String::new(),
        };
        assert_eq!(
            target.child_remote_path(&item).unwrap(),
            "/Documents/report.pdf"
        );
    }
}
