use std::collections::HashMap;

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::infra::storage::StorageService;

use super::{
    FileSyncAction, FileSyncChange, FileSyncConflict, FileSyncEntry, FileSyncEntryId,
    FileSyncEntryState, FileSyncFinalEvent, FileSyncLocalEntry, FileSyncRemoteEntry,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSyncRemotePathRef {
    pub remote_name: String,
    pub remote_path: String,
}

#[derive(Default)]
struct EntryCache {
    local_entries: HashMap<FileSyncEntryId, FileSyncLocalEntry>,
    remote_entries: HashMap<FileSyncEntryId, FileSyncRemoteEntry>,
    sync_entries: HashMap<FileSyncEntryId, FileSyncEntry>,
    local_paths: HashMap<String, FileSyncEntryId>,
    remote_paths: HashMap<String, FileSyncEntryId>,
    provider_ids: HashMap<String, FileSyncEntryId>,
}

/// Proxy-backed sync metadata boundary with a process-local hot cache.
pub struct FileSyncEntryStore {
    proxy: Option<StorageService>,
    cache: RwLock<EntryCache>,
}

impl Default for FileSyncEntryStore {
    fn default() -> Self {
        Self::new(None)
    }
}

impl FileSyncEntryStore {
    pub fn new(proxy: Option<StorageService>) -> Self {
        Self {
            proxy,
            cache: RwLock::new(EntryCache::default()),
        }
    }

    pub fn remote_key(remote_name: &str, path: &str) -> String {
        format!("{remote_name}:{path}")
    }

    pub async fn entry(&self, event: &FileSyncFinalEvent) -> FileSyncEntryId {
        if is_remote_change(event.change) {
            if !event.data.provider_file_id.is_empty() {
                if let Some(id) = self.provider_id(&event.data.provider_file_id).await {
                    return id;
                }
            }
            if !event.remote_name.is_empty() && !event.pending_event.old_path.is_empty() {
                if let Some(id) = self
                    .remote_id(&event.remote_name, &event.pending_event.old_path)
                    .await
                {
                    return id;
                }
            }
            if !event.remote_name.is_empty() && !event.pending_event.new_path.is_empty() {
                if let Some(id) = self
                    .remote_id(&event.remote_name, &event.pending_event.new_path)
                    .await
                {
                    return id;
                }
            }
            return Uuid::new_v4().to_string();
        }

        if !event.pending_event.old_path.is_empty() {
            if let Some(id) = self.local_id(&event.pending_event.old_path).await {
                self.cache
                    .write()
                    .await
                    .local_paths
                    .remove(&event.pending_event.old_path);
                return id;
            }
        }
        if !event.pending_event.new_path.is_empty() {
            if let Some(id) = self.local_id(&event.pending_event.new_path).await {
                return id;
            }
        }
        Uuid::new_v4().to_string()
    }

    pub async fn put_local(&self, entry: FileSyncLocalEntry) {
        let persisted = self
            .post_and_parse("/api/file-sync/local", &entry)
            .await
            .unwrap_or(entry);
        self.cache_local_entry(persisted).await;
    }

    pub async fn put_remote(&self, entry: FileSyncRemoteEntry) {
        let persisted = self
            .post_and_parse("/api/file-sync/remote", &entry)
            .await
            .unwrap_or(entry);
        self.cache_remote_entry(persisted).await;
    }

    pub async fn put_sync(&self, entry: FileSyncEntry) {
        let persisted = self
            .post_and_parse("/api/file-sync/sync", &entry)
            .await
            .unwrap_or(entry);
        self.cache_sync_entry(persisted).await;
    }

    pub async fn record(&self, event: &FileSyncFinalEvent) {
        let body = serde_json::json!({
            "remote_name": event.remote_name,
            "change": change_label(event.change),
            "pending_event": {
                "key": event.pending_event.key,
                "old_path": event.pending_event.old_path,
                "new_path": event.pending_event.new_path,
            },
            "data": {
                "is_dir": event.data.is_dir,
                "size": event.data.size,
                "mtime": event.data.mtime,
                "content_hash": event.data.content_hash,
                "created": event.data.created,
                "provider_file_id": event.data.provider_file_id,
            },
            "result": {
                "action": action_label(event.result.action),
                "conflict": conflict_label(event.result.conflict),
                "update_entry": event.result.update_entry,
            },
        });
        let Some(value) = self.post_json("/api/file-sync/record", &body).await else {
            return;
        };
        if let Ok(bundle) = serde_json::from_value::<RecordBundle>(value) {
            if let Some(local) = bundle.local {
                self.cache_local_entry(local).await;
            }
            if let Some(remote) = bundle.remote {
                self.cache_remote_entry(remote).await;
            }
            if let Some(sync) = bundle.sync {
                self.cache_sync_entry(sync).await;
            }
        }
    }

    pub async fn reset(&self) {
        if self
            .post_success("/api/file-sync/reset", &serde_json::json!({}))
            .await
        {
            *self.cache.write().await = EntryCache::default();
        }
    }

    pub async fn clear_cache(&self) {
        *self.cache.write().await = EntryCache::default();
    }

    pub async fn local(&self, entry_id: &str) -> Option<FileSyncLocalEntry> {
        if let Some(entry) = self.cache.read().await.local_entries.get(entry_id).cloned() {
            return Some(entry);
        }
        let entry: FileSyncLocalEntry = self
            .get_and_parse("/api/file-sync/local", &[("entry_id", entry_id)])
            .await?;
        self.cache_local_entry(entry.clone()).await;
        Some(entry)
    }

    pub async fn remote(&self, entry_id: &str) -> Option<FileSyncRemoteEntry> {
        if let Some(entry) = self
            .cache
            .read()
            .await
            .remote_entries
            .get(entry_id)
            .cloned()
        {
            return Some(entry);
        }
        let entry: FileSyncRemoteEntry = self
            .get_and_parse("/api/file-sync/remote", &[("entry_id", entry_id)])
            .await?;
        self.cache_remote_entry(entry.clone()).await;
        Some(entry)
    }

    pub async fn sync(&self, entry_id: &str) -> Option<FileSyncEntry> {
        if let Some(entry) = self.cache.read().await.sync_entries.get(entry_id).cloned() {
            return Some(entry);
        }
        let entry: FileSyncEntry = self
            .get_and_parse("/api/file-sync/sync", &[("entry_id", entry_id)])
            .await?;
        self.cache_sync_entry(entry.clone()).await;
        Some(entry)
    }

    pub async fn local_id(&self, path: &str) -> Option<FileSyncEntryId> {
        if let Some(id) = self.cache.read().await.local_paths.get(path).cloned() {
            return Some(id);
        }
        self.fetch_id("/api/file-sync/local/id", &[("path", path)])
            .await
    }

    pub async fn remote_id(&self, remote_name: &str, path: &str) -> Option<FileSyncEntryId> {
        let key = Self::remote_key(remote_name, path);
        if let Some(id) = self.cache.read().await.remote_paths.get(&key).cloned() {
            return Some(id);
        }
        self.fetch_id(
            "/api/file-sync/remote/id",
            &[("remote", remote_name), ("path", path)],
        )
        .await
    }

    pub async fn provider_id(&self, provider_file_id: &str) -> Option<FileSyncEntryId> {
        if let Some(id) = self
            .cache
            .read()
            .await
            .provider_ids
            .get(provider_file_id)
            .cloned()
        {
            return Some(id);
        }
        self.fetch_id(
            "/api/file-sync/provider/id",
            &[("provider_file_id", provider_file_id)],
        )
        .await
    }

    pub async fn local_states(&self, paths: &[String]) -> HashMap<String, FileSyncEntryState> {
        if paths.is_empty() {
            return HashMap::new();
        }
        let Some(value) = self
            .post_json(
                "/api/file-sync/states/resolve",
                &serde_json::json!({ "local_paths": paths, "remote_paths": [] }),
            )
            .await
        else {
            return HashMap::new();
        };
        value
            .get("local")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let path = item.get("local_path")?.as_str()?;
                let state = parse_state(item.get("state")?.as_str()?);
                (!path.is_empty()).then(|| (path.to_string(), state))
            })
            .collect()
    }

    pub async fn remote_states(
        &self,
        refs: &[FileSyncRemotePathRef],
    ) -> HashMap<String, FileSyncEntryState> {
        if refs.is_empty() {
            return HashMap::new();
        }
        let Some(value) = self
            .post_json(
                "/api/file-sync/states/resolve",
                &serde_json::json!({ "local_paths": [], "remote_paths": refs }),
            )
            .await
        else {
            return HashMap::new();
        };
        value
            .get("remote")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let remote_name = item.get("remote_name")?.as_str()?;
                let remote_path = item.get("remote_path")?.as_str()?;
                let state = parse_state(item.get("state")?.as_str()?);
                (!remote_name.is_empty() && !remote_path.is_empty())
                    .then(|| (Self::remote_key(remote_name, remote_path), state))
            })
            .collect()
    }

    async fn fetch_id(&self, path: &str, query: &[(&str, &str)]) -> Option<FileSyncEntryId> {
        let value: serde_json::Value = self.get_and_parse(path, query).await?;
        value.get("entry_id")?.as_str().map(ToOwned::to_owned)
    }

    async fn cache_local_entry(&self, entry: FileSyncLocalEntry) {
        let mut cache = self.cache.write().await;
        if let Some(old) = cache.local_entries.get(&entry.entry_id) {
            if !old.local_path.is_empty() {
                let old_path = old.local_path.clone();
                cache.local_paths.remove(&old_path);
            }
        }
        if !entry.local_path.is_empty() {
            cache
                .local_paths
                .insert(entry.local_path.clone(), entry.entry_id.clone());
        }
        cache.local_entries.insert(entry.entry_id.clone(), entry);
    }

    async fn cache_remote_entry(&self, entry: FileSyncRemoteEntry) {
        let mut cache = self.cache.write().await;
        if let Some(old) = cache.remote_entries.get(&entry.entry_id).cloned() {
            if !old.remote_path.is_empty() {
                cache
                    .remote_paths
                    .remove(&Self::remote_key(&old.remote_name, &old.remote_path));
            }
            if !old.provider_file_id.is_empty() {
                cache.provider_ids.remove(&old.provider_file_id);
            }
        }
        if !entry.remote_name.is_empty() && !entry.remote_path.is_empty() {
            cache.remote_paths.insert(
                Self::remote_key(&entry.remote_name, &entry.remote_path),
                entry.entry_id.clone(),
            );
        }
        if !entry.provider_file_id.is_empty() {
            cache
                .provider_ids
                .insert(entry.provider_file_id.clone(), entry.entry_id.clone());
        }
        cache.remote_entries.insert(entry.entry_id.clone(), entry);
    }

    async fn cache_sync_entry(&self, entry: FileSyncEntry) {
        self.cache
            .write()
            .await
            .sync_entries
            .insert(entry.entry_id.clone(), entry);
    }

    async fn post_and_parse<T>(&self, path: &str, body: &T) -> Option<T>
    where
        T: Serialize + DeserializeOwned,
    {
        let body = serde_json::to_value(body).ok()?;
        let value = self.post_json(path, &body).await?;
        serde_json::from_value(value).ok()
    }

    async fn post_json(&self, path: &str, body: &serde_json::Value) -> Option<serde_json::Value> {
        let response = self.proxy.as_ref()?.post_json(path, body).await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.json().await.ok()
    }

    async fn post_success(&self, path: &str, body: &serde_json::Value) -> bool {
        let Some(proxy) = &self.proxy else {
            return false;
        };
        match proxy.post_json(path, body).await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    async fn get_and_parse<T>(&self, path: &str, query: &[(&str, &str)]) -> Option<T>
    where
        T: DeserializeOwned,
    {
        let response = self
            .proxy
            .as_ref()?
            .get_with_query(path, query)
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        response.json().await.ok()
    }
}

#[derive(Deserialize)]
struct RecordBundle {
    local: Option<FileSyncLocalEntry>,
    remote: Option<FileSyncRemoteEntry>,
    sync: Option<FileSyncEntry>,
}

fn is_remote_change(change: FileSyncChange) -> bool {
    matches!(
        change,
        FileSyncChange::RemoteFile
            | FileSyncChange::RemoteFolder
            | FileSyncChange::RemoteDelete
            | FileSyncChange::RemoteRename
    )
}

fn parse_state(state: &str) -> FileSyncEntryState {
    match state {
        "REM" => FileSyncEntryState::Remote,
        "SYNC" => FileSyncEntryState::Synchronized,
        "CONFLICT" => FileSyncEntryState::Conflict,
        _ => FileSyncEntryState::Local,
    }
}

fn change_label(change: FileSyncChange) -> &'static str {
    match change {
        FileSyncChange::LocalFile => "LocalFile",
        FileSyncChange::LocalFolder => "LocalFolder",
        FileSyncChange::LocalDelete => "LocalDelete",
        FileSyncChange::LocalRename => "LocalRename",
        FileSyncChange::RemoteFile => "RemoteFile",
        FileSyncChange::RemoteFolder => "RemoteFolder",
        FileSyncChange::RemoteDelete => "RemoteDelete",
        FileSyncChange::RemoteRename => "RemoteRename",
        FileSyncChange::Noop => "Noop",
    }
}

fn action_label(action: FileSyncAction) -> &'static str {
    match action {
        FileSyncAction::Noop => "Noop",
        FileSyncAction::UploadLocal => "UploadLocal",
        FileSyncAction::DownloadRemote => "DownloadRemote",
        FileSyncAction::DeleteLocal => "DeleteLocal",
        FileSyncAction::DeleteRemote => "DeleteRemote",
        FileSyncAction::RenameLocal => "RenameLocal",
        FileSyncAction::RenameRemote => "RenameRemote",
        FileSyncAction::Conflict => "Conflict",
    }
}

fn conflict_label(conflict: FileSyncConflict) -> &'static str {
    match conflict {
        FileSyncConflict::None => "None",
        FileSyncConflict::LocalTmp => "LocalTmp",
        FileSyncConflict::RemoteTmp => "RemoteTmp",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::file_sync::{FileSyncData, FileSyncPendingEvent};

    #[tokio::test]
    async fn local_cache_replaces_path_index() {
        let store = FileSyncEntryStore::default();
        store
            .put_local(FileSyncLocalEntry {
                entry_id: "entry".into(),
                local_path: "/before".into(),
                exists: true,
                ..Default::default()
            })
            .await;
        store
            .put_local(FileSyncLocalEntry {
                entry_id: "entry".into(),
                local_path: "/after".into(),
                exists: true,
                ..Default::default()
            })
            .await;
        assert_eq!(store.local_id("/before").await, None);
        assert_eq!(store.local_id("/after").await.as_deref(), Some("entry"));
    }

    #[tokio::test]
    async fn rename_reuses_stable_local_entry_id() {
        let store = FileSyncEntryStore::default();
        store
            .put_local(FileSyncLocalEntry {
                entry_id: "stable".into(),
                local_path: "/before".into(),
                exists: true,
                ..Default::default()
            })
            .await;
        let event = FileSyncFinalEvent {
            change: FileSyncChange::LocalRename,
            pending_event: FileSyncPendingEvent {
                old_path: "/before".into(),
                new_path: "/after".into(),
                ..Default::default()
            },
            data: FileSyncData::default(),
            ..Default::default()
        };
        assert_eq!(store.entry(&event).await, "stable");
    }
}
