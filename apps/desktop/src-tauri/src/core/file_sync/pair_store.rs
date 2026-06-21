use std::{fs, path::PathBuf, time::Duration};

use rusqlite::{params, Connection};

use crate::error::{ApiError, ApiResult};

use super::{FileSyncEndpoint, FileSyncEndpointKind, FileSyncPair, FileSyncPolicy};

#[derive(Debug, Clone)]
pub struct FileSyncPairStore {
    db_path: PathBuf,
}

impl FileSyncPairStore {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    pub async fn load_all(&self) -> ApiResult<Vec<FileSyncPair>> {
        let path = self.db_path.clone();
        tokio::task::spawn_blocking(move || load_all(&path))
            .await
            .map_err(|error| ApiError::Message(format!("Sync pair worker failed: {error}")))?
    }

    pub async fn save(&self, pair: FileSyncPair) -> ApiResult<FileSyncPair> {
        let path = self.db_path.clone();
        tokio::task::spawn_blocking(move || save(&path, pair))
            .await
            .map_err(|error| ApiError::Message(format!("Sync pair worker failed: {error}")))?
    }

    pub async fn remove(&self, pair_id: i64) -> ApiResult<()> {
        let path = self.db_path.clone();
        tokio::task::spawn_blocking(move || remove(&path, pair_id))
            .await
            .map_err(|error| ApiError::Message(format!("Sync pair worker failed: {error}")))?
    }
}

fn load_all(path: &PathBuf) -> ApiResult<Vec<FileSyncPair>> {
    let connection = open(path)?;
    let mut statement = connection
        .prepare(
            "SELECT id, name,
                left_kind, left_local_path, left_remote_name, left_remote_path, left_provider_type,
                right_kind, right_local_path, right_remote_name, right_remote_path, right_provider_type,
                watch_mode, stale, preferred_policy, last_compared_at_ms, last_scan_at_ms
             FROM sync_pairs ORDER BY id ASC",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(FileSyncPair {
                id: row.get(0)?,
                name: row.get(1)?,
                left: FileSyncEndpoint {
                    kind: endpoint_kind_from_text(&row.get::<_, String>(2)?),
                    local_path: row.get(3)?,
                    remote_name: row.get(4)?,
                    remote_path: row.get(5)?,
                    provider_type: row.get(6)?,
                },
                right: FileSyncEndpoint {
                    kind: endpoint_kind_from_text(&row.get::<_, String>(7)?),
                    local_path: row.get(8)?,
                    remote_name: row.get(9)?,
                    remote_path: row.get(10)?,
                    provider_type: row.get(11)?,
                },
                watch_mode: row.get::<_, i64>(12)? != 0,
                stale: row.get::<_, i64>(13)? != 0,
                preferred_policy: policy_from_text(&row.get::<_, String>(14)?),
                last_compared_at_ms: row.get(15)?,
                last_scan_at_ms: row.get(16)?,
            })
        })
        .map_err(sql_error)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql_error)
}

fn save(path: &PathBuf, mut pair: FileSyncPair) -> ApiResult<FileSyncPair> {
    let mut connection = open(path)?;
    let transaction = connection.transaction().map_err(sql_error)?;
    if pair.id == 0 {
        pair.id = transaction
            .query_row(
                "SELECT COALESCE(MAX(id), 0) + 1 FROM sync_pairs",
                [],
                |row| row.get(0),
            )
            .map_err(sql_error)?;
    }
    transaction
        .execute(
            "INSERT OR REPLACE INTO sync_pairs (
                id, name,
                left_kind, left_local_path, left_remote_name, left_remote_path, left_provider_type,
                right_kind, right_local_path, right_remote_name, right_remote_path, right_provider_type,
                watch_mode, stale, preferred_policy, last_compared_at_ms, last_scan_at_ms
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                pair.id,
                pair.name,
                endpoint_kind_label(pair.left.kind),
                pair.left.local_path,
                pair.left.remote_name,
                pair.left.remote_path,
                pair.left.provider_type,
                endpoint_kind_label(pair.right.kind),
                pair.right.local_path,
                pair.right.remote_name,
                pair.right.remote_path,
                pair.right.provider_type,
                pair.watch_mode,
                pair.stale,
                policy_label(pair.preferred_policy),
                pair.last_compared_at_ms,
                pair.last_scan_at_ms,
            ],
        )
        .map_err(sql_error)?;
    transaction.commit().map_err(sql_error)?;
    Ok(pair)
}

fn remove(path: &PathBuf, pair_id: i64) -> ApiResult<()> {
    let connection = open(path)?;
    connection
        .execute("DELETE FROM sync_pairs WHERE id = ?", [pair_id])
        .map_err(sql_error)?;
    Ok(())
}

fn open(path: &PathBuf) -> ApiResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            ApiError::Message(format!("Failed to create sync database directory: {error}"))
        })?;
    }
    let connection = Connection::open(path).map_err(sql_error)?;
    connection
        .busy_timeout(Duration::from_millis(3000))
        .map_err(sql_error)?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS sync_pairs (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                left_kind TEXT NOT NULL DEFAULT 'local',
                left_local_path TEXT NOT NULL DEFAULT '',
                left_remote_name TEXT NOT NULL DEFAULT '',
                left_remote_path TEXT NOT NULL DEFAULT '',
                left_provider_type TEXT NOT NULL DEFAULT '',
                right_kind TEXT NOT NULL DEFAULT 'local',
                right_local_path TEXT NOT NULL DEFAULT '',
                right_remote_name TEXT NOT NULL DEFAULT '',
                right_remote_path TEXT NOT NULL DEFAULT '',
                right_provider_type TEXT NOT NULL DEFAULT '',
                watch_mode INTEGER NOT NULL DEFAULT 0,
                stale INTEGER NOT NULL DEFAULT 0,
                preferred_policy TEXT NOT NULL DEFAULT 'bidirectional',
                last_compared_at_ms INTEGER NOT NULL DEFAULT 0,
                last_scan_at_ms INTEGER NOT NULL DEFAULT 0
            );",
        )
        .map_err(sql_error)?;
    Ok(connection)
}

fn endpoint_kind_label(kind: FileSyncEndpointKind) -> &'static str {
    match kind {
        FileSyncEndpointKind::Local => "local",
        FileSyncEndpointKind::Remote => "remote",
    }
}

fn endpoint_kind_from_text(value: &str) -> FileSyncEndpointKind {
    if value == "remote" {
        FileSyncEndpointKind::Remote
    } else {
        FileSyncEndpointKind::Local
    }
}

fn policy_label(policy: FileSyncPolicy) -> &'static str {
    match policy {
        FileSyncPolicy::RemoteFirst => "remote_first",
        FileSyncPolicy::LocalFirst => "local_first",
        FileSyncPolicy::BiDirectional => "bidirectional",
    }
}

fn policy_from_text(value: &str) -> FileSyncPolicy {
    match value {
        "remote_first" => FileSyncPolicy::RemoteFirst,
        "local_first" => FileSyncPolicy::LocalFirst,
        _ => FileSyncPolicy::BiDirectional,
    }
}

fn sql_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("Sync pair database error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn test_store() -> (FileSyncPairStore, PathBuf) {
        let root = std::env::temp_dir().join(format!("misty-sync-pairs-{}", Uuid::new_v4()));
        (FileSyncPairStore::new(root.join("misty.db")), root)
    }

    #[tokio::test]
    async fn saves_loads_replaces_and_removes_pairs() {
        let (store, root) = test_store();
        let pair = store
            .save(FileSyncPair {
                name: "Documents".into(),
                left: FileSyncEndpoint {
                    kind: FileSyncEndpointKind::Local,
                    local_path: "/tmp/docs".into(),
                    ..Default::default()
                },
                right: FileSyncEndpoint {
                    kind: FileSyncEndpointKind::Remote,
                    remote_name: "drive".into(),
                    remote_path: "/docs".into(),
                    provider_type: "drive".into(),
                    ..Default::default()
                },
                watch_mode: true,
                preferred_policy: FileSyncPolicy::LocalFirst,
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(pair.id, 1);
        assert_eq!(store.load_all().await.unwrap(), vec![pair.clone()]);

        let mut replacement = pair.clone();
        replacement.name = "Renamed".into();
        store.save(replacement.clone()).await.unwrap();
        assert_eq!(store.load_all().await.unwrap(), vec![replacement]);

        store.remove(pair.id).await.unwrap();
        assert!(store.load_all().await.unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn assigns_monotonic_ids() {
        let (store, root) = test_store();
        let first = store.save(FileSyncPair::default()).await.unwrap();
        let second = store.save(FileSyncPair::default()).await.unwrap();
        assert_eq!((first.id, second.id), (1, 2));
        let _ = fs::remove_dir_all(root);
    }
}
