use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{ApiError, ApiResult};
use crate::infra::environment::AppEnvironmentService;

const MAX_RECENT_ITEMS: usize = 20;

#[derive(Debug, Clone)]
pub struct ExplorerLibraryService {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerLibraryItem {
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub id: String,
    #[serde(alias = "is_dir")]
    pub is_dir: bool,
    #[serde(default)]
    pub size: i64,
    #[serde(default, alias = "last_modified")]
    pub last_modified: String,
    #[serde(default, alias = "mime_type")]
    pub mime_type: String,
    #[serde(default)]
    pub r#type: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub comments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerLibrarySnapshot {
    #[serde(default)]
    pub path: String,
    #[serde(default, alias = "recent_files")]
    pub recent_files: Vec<ExplorerLibraryItem>,
    #[serde(default, alias = "starred_files")]
    pub starred_files: Vec<ExplorerLibraryItem>,
    #[serde(default, alias = "last_opened_path")]
    pub last_opened_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRecentRequest {
    pub item: ExplorerLibraryItem,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordLastOpenedRequest {
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTagsRequest {
    pub item: ExplorerLibraryItem,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub comments: Option<String>,
}

impl ExplorerLibraryService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            path: environment.cache_dir().join("explorer_state.json"),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<ExplorerLibrarySnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || load_snapshot(path))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer library worker failed: {err}")))?
    }

    pub async fn record_recent(
        &self,
        request: RecordRecentRequest,
    ) -> ApiResult<ExplorerLibrarySnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let mut snapshot = load_snapshot(path.clone())?;
            add_recent(&mut snapshot, request.item);
            save_snapshot(&path, &snapshot)?;
            load_snapshot(path)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Explorer library worker failed: {err}")))?
    }

    pub async fn record_last_opened(
        &self,
        request: RecordLastOpenedRequest,
    ) -> ApiResult<ExplorerLibrarySnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let mut snapshot = load_snapshot(path.clone())?;
            snapshot.last_opened_path = request.path;
            save_snapshot(&path, &snapshot)?;
            load_snapshot(path)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Explorer library worker failed: {err}")))?
    }

    pub async fn set_tags(&self, request: SetTagsRequest) -> ApiResult<ExplorerLibrarySnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            let mut snapshot = load_snapshot(path.clone())?;
            set_item_metadata(
                &mut snapshot,
                request.item,
                sanitize_tags(request.tags),
                request.comments.map(sanitize_comment),
            );
            save_snapshot(&path, &snapshot)?;
            load_snapshot(path)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Explorer library worker failed: {err}")))?
    }
}

fn load_snapshot(path: PathBuf) -> ApiResult<ExplorerLibrarySnapshot> {
    let mut snapshot = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<ExplorerLibrarySnapshot>(&raw).unwrap_or_default(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            ExplorerLibrarySnapshot::default()
        }
        Err(err) => {
            return Err(ApiError::Message(format!(
                "Failed to read explorer library {}: {err}",
                path.display()
            )));
        }
    };
    snapshot.path = path.display().to_string();
    Ok(snapshot)
}

fn save_snapshot(path: &Path, snapshot: &ExplorerLibrarySnapshot) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ApiError::Message(format!(
                "Failed to create explorer library directory {}: {err}",
                parent.display()
            ))
        })?;
    }
    let document = json!({
        "recent_files": snapshot.recent_files.iter().map(disk_item_json).collect::<Vec<_>>(),
        "starred_files": snapshot.starred_files.iter().map(disk_item_json).collect::<Vec<_>>(),
        "last_opened_path": snapshot.last_opened_path,
    });
    let raw = serde_json::to_string_pretty(&document)
        .map_err(|err| ApiError::Message(format!("Failed to serialize explorer library: {err}")))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &raw).map_err(|err| {
        ApiError::Message(format!(
            "Failed to write explorer library {}: {err}",
            tmp.display()
        ))
    })?;
    fs::rename(&tmp, path)
        .or_else(|_| {
            let _ = fs::remove_file(&tmp);
            fs::write(path, &raw)
        })
        .map_err(|err| {
            ApiError::Message(format!(
                "Failed to save explorer library {}: {err}",
                path.display()
            ))
        })
}

fn disk_item_json(item: &ExplorerLibraryItem) -> serde_json::Value {
    json!({
        "path": item.path,
        "name": item.name,
        "id": item.id,
        "is_dir": item.is_dir,
        "size": item.size,
        "last_modified": item.last_modified,
        "mime_type": item.mime_type,
        "type": item.r#type,
        "tags": item.tags,
        "comments": item.comments,
    })
}

fn add_recent(snapshot: &mut ExplorerLibrarySnapshot, item: ExplorerLibraryItem) {
    if item.path.trim().is_empty() {
        return;
    }
    snapshot
        .recent_files
        .retain(|candidate| candidate.path != item.path);
    snapshot.recent_files.insert(0, item);
    snapshot.recent_files.truncate(MAX_RECENT_ITEMS);
}

fn set_item_metadata(
    snapshot: &mut ExplorerLibrarySnapshot,
    mut item: ExplorerLibraryItem,
    tags: Vec<String>,
    comments: Option<String>,
) {
    if item.path.trim().is_empty() {
        return;
    }
    item.tags = tags.clone();
    if let Some(comments) = comments.clone() {
        item.comments = comments;
    } else if let Some(existing) = snapshot
        .recent_files
        .iter()
        .chain(snapshot.starred_files.iter())
        .find(|candidate| candidate.path == item.path)
    {
        item.comments = existing.comments.clone();
    }
    upsert_tagged_item(&mut snapshot.recent_files, item.clone());
    if let Some(starred) = snapshot
        .starred_files
        .iter_mut()
        .find(|candidate| candidate.path == item.path)
    {
        starred.tags = tags;
        if let Some(comments) = comments {
            starred.comments = comments;
        }
    }
}

fn upsert_tagged_item(items: &mut Vec<ExplorerLibraryItem>, item: ExplorerLibraryItem) {
    if let Some(existing) = items
        .iter_mut()
        .find(|candidate| candidate.path == item.path)
    {
        *existing = item;
        return;
    }
    items.insert(0, item);
    items.truncate(MAX_RECENT_ITEMS);
}

fn sanitize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = tag.trim().to_owned();
        if tag.is_empty() || normalized.iter().any(|existing| existing == &tag) {
            continue;
        }
        normalized.push(tag);
    }
    normalized
}

fn sanitize_comment(comment: String) -> String {
    comment.trim().chars().take(4000).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn record_recent_deduplicates_and_caps_items() {
        let mut snapshot = ExplorerLibrarySnapshot::default();
        for index in 0..25 {
            add_recent(&mut snapshot, item(&format!("/tmp/{index}")));
        }
        assert_eq!(snapshot.recent_files.len(), MAX_RECENT_ITEMS);
        add_recent(&mut snapshot, item("/tmp/12"));
        assert_eq!(snapshot.recent_files[0].path, "/tmp/12");
        assert_eq!(
            snapshot
                .recent_files
                .iter()
                .filter(|item| item.path == "/tmp/12")
                .count(),
            1
        );
    }

    #[test]
    fn snapshot_round_trips_native_snake_case_document() {
        let path = std::env::temp_dir()
            .join(format!("misty-library-test-{}", Uuid::new_v4()))
            .join("explorer_state.json");
        fs::create_dir_all(path.parent().expect("test parent")).expect("create parent");
        fs::write(
            &path,
            r#"{
              "recent_files": [{"path": "/tmp/demo.txt", "name": "demo.txt", "id": "/tmp/demo.txt", "is_dir": false, "last_modified": "today", "mime_type": "text/plain", "type": 0}],
              "starred_files": [],
              "last_opened_path": "/tmp"
            }"#,
        ).expect("write fixture");

        let snapshot = load_snapshot(path.clone()).expect("load snapshot");
        assert_eq!(snapshot.recent_files[0].path, "/tmp/demo.txt");
        assert!(!snapshot.recent_files[0].is_dir);
        assert_eq!(snapshot.last_opened_path, "/tmp");
        fs::remove_dir_all(path.parent().unwrap()).expect("cleanup");
    }

    #[test]
    fn set_item_tags_upserts_and_deduplicates() {
        let mut snapshot = ExplorerLibrarySnapshot::default();
        set_item_metadata(
            &mut snapshot,
            item("/tmp/demo.txt"),
            sanitize_tags(vec![
                "work".to_owned(),
                " work ".to_owned(),
                "".to_owned(),
                "draft".to_owned(),
            ]),
            Some(sanitize_comment("first note".to_owned())),
        );

        assert_eq!(snapshot.recent_files.len(), 1);
        assert_eq!(snapshot.recent_files[0].tags, vec!["work", "draft"]);
        assert_eq!(snapshot.recent_files[0].comments, "first note");

        set_item_metadata(
            &mut snapshot,
            item("/tmp/demo.txt"),
            sanitize_tags(vec!["final".to_owned()]),
            None,
        );

        assert_eq!(snapshot.recent_files.len(), 1);
        assert_eq!(snapshot.recent_files[0].tags, vec!["final"]);
        assert_eq!(snapshot.recent_files[0].comments, "first note");
    }

    fn item(path: &str) -> ExplorerLibraryItem {
        ExplorerLibraryItem {
            path: path.to_owned(),
            name: path.rsplit('/').next().unwrap_or(path).to_owned(),
            id: path.to_owned(),
            is_dir: false,
            size: 0,
            last_modified: String::new(),
            mime_type: String::new(),
            r#type: 0,
            tags: Vec::new(),
            comments: String::new(),
        }
    }
}
