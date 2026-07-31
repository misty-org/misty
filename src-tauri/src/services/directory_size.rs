use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex as AsyncMutex;
use walkdir::WalkDir;

use crate::{
    core::file_master::RemoteBrowseTarget,
    error::{ApiError, ApiResult},
    services::{
        environment::AppEnvironmentService, macos_privacy::is_background_scan_excluded,
        storage::StorageService,
    },
};

const DIRECTORY_SIZE_CACHE_TTL_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Clone)]
pub struct DirectorySizeService {
    inner: Arc<DirectorySizeInner>,
}

struct DirectorySizeInner {
    db_path: PathBuf,
    db_lock: Arc<Mutex<()>>,
    home_dir: PathBuf,
    mount_root: PathBuf,
    proxy: StorageService,
    calculating: AsyncMutex<HashSet<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySizeRequest {
    pub paths: Vec<String>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySizeRecord {
    pub path: String,
    pub size_bytes: Option<u64>,
    pub status: DirectorySizeStatus,
    pub calculated_at_ms: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectorySizeStatus {
    Unknown,
    Calculating,
    Ready,
    Failed,
}

#[derive(Debug, Clone)]
struct StoredDirectorySizeRecord {
    path: String,
    size_bytes: Option<u64>,
    calculated_at_ms: i64,
    status: StoredDirectorySizeStatus,
    error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StoredDirectorySizeStatus {
    Ready,
    Failed,
}

enum DirectorySizeTarget {
    Local(PathBuf),
    Remote(RemoteBrowseTarget),
}

impl DirectorySizeService {
    pub fn new(environment: AppEnvironmentService, proxy: StorageService) -> Self {
        Self {
            inner: Arc::new(DirectorySizeInner {
                db_path: environment.misty_db_path(),
                db_lock: Arc::new(Mutex::new(())),
                home_dir: environment.home_dir(),
                mount_root: environment.mount_root(),
                proxy,
                calculating: AsyncMutex::new(HashSet::new()),
            }),
        }
    }

    pub async fn snapshot(&self, paths: Vec<String>) -> ApiResult<Vec<DirectorySizeRecord>> {
        let keys = self.normalize_paths(paths);
        let paths = keys
            .iter()
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        let query_paths = paths.clone();
        let db_path = self.inner.db_path.clone();
        let db_lock = self.inner.db_lock.clone();
        let stored = tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            load_records(&db_path, &query_paths)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Directory size worker failed: {err}")))??;
        let calculating = self.inner.calculating.lock().await;
        let now = now_ms();
        Ok(paths
            .into_iter()
            .map(|path| record_for_path(&path, stored.get(&path), calculating.contains(&path), now))
            .collect())
    }

    pub async fn calculate(
        &self,
        request: DirectorySizeRequest,
    ) -> ApiResult<Vec<DirectorySizeRecord>> {
        let targets = self.normalize_paths(request.paths);
        let mut records = Vec::with_capacity(targets.len());
        for (path, target) in targets {
            if !request.force {
                if let Some(record) = self.fresh_cached_record(&path).await? {
                    records.push(record);
                    continue;
                }
            }
            if !self.mark_calculating(&path).await {
                records.push(DirectorySizeRecord {
                    path,
                    size_bytes: None,
                    status: DirectorySizeStatus::Calculating,
                    calculated_at_ms: None,
                    error: None,
                });
                continue;
            }
            let result = self.calculate_target(target).await;
            self.unmark_calculating(&path).await;
            let record = self.store_result(path, result).await?;
            records.push(record);
        }
        Ok(records)
    }

    fn normalize_paths(&self, paths: Vec<String>) -> Vec<(String, DirectorySizeTarget)> {
        let mut seen = HashSet::new();
        let mut targets = Vec::new();
        for raw_path in paths {
            let trimmed = raw_path.trim();
            if trimmed.is_empty() {
                continue;
            }
            let path = PathBuf::from(trimmed);
            let target = if let Some(remote) =
                RemoteBrowseTarget::from_virtual_path(&self.inner.mount_root, &path)
            {
                let normalized_path = display_path(&remote.virtual_path(&self.inner.mount_root));
                (normalized_path, DirectorySizeTarget::Remote(remote))
            } else {
                let normalized_path = path
                    .canonicalize()
                    .unwrap_or(path)
                    .to_string_lossy()
                    .to_string();
                (
                    normalized_path.clone(),
                    DirectorySizeTarget::Local(PathBuf::from(normalized_path)),
                )
            };
            if seen.insert(target.0.clone()) {
                targets.push(target);
            }
        }
        targets
    }

    async fn fresh_cached_record(&self, path: &str) -> ApiResult<Option<DirectorySizeRecord>> {
        let db_path = self.inner.db_path.clone();
        let db_lock = self.inner.db_lock.clone();
        let path = path.to_string();
        let query_path = path.clone();
        let stored = tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            load_record(&db_path, &query_path)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Directory size worker failed: {err}")))??;
        let calculating = self.inner.calculating.lock().await;
        let record = record_for_path(
            &path,
            stored.as_ref(),
            calculating.contains(&path),
            now_ms(),
        );
        Ok((record.status == DirectorySizeStatus::Ready).then_some(record))
    }

    async fn mark_calculating(&self, path: &str) -> bool {
        self.inner.calculating.lock().await.insert(path.to_string())
    }

    async fn unmark_calculating(&self, path: &str) {
        self.inner.calculating.lock().await.remove(path);
    }

    async fn calculate_target(&self, target: DirectorySizeTarget) -> Result<u64, String> {
        match target {
            DirectorySizeTarget::Local(path) => {
                let home_dir = self.inner.home_dir.clone();
                tokio::task::spawn_blocking(move || local_directory_size(&path, &home_dir))
                    .await
                    .map_err(|error| format!("Directory size worker failed: {error}"))
                    .and_then(|result| result)
            }
            DirectorySizeTarget::Remote(target) => self.remote_directory_size(&target).await,
        }
    }

    async fn remote_directory_size(&self, target: &RemoteBrowseTarget) -> Result<u64, String> {
        let response = self
            .inner
            .proxy
            .get_with_query(
                "/api/remote/file/size",
                &[
                    ("remote", target.remote_name.as_str()),
                    ("path", target.remote_path.as_str()),
                ],
            )
            .await
            .map_err(|error| error.to_string())?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(if body.is_empty() {
                format!(
                    "Failed to calculate remote directory size (HTTP {})",
                    status.as_u16()
                )
            } else {
                body
            });
        }
        let value = serde_json::from_str::<Value>(&body)
            .map_err(|error| format!("Failed to parse remote directory size: {error}"))?;
        remote_size_from_value(&value).ok_or_else(|| {
            "Remote directory size response did not include a byte count.".to_string()
        })
    }

    async fn store_result(
        &self,
        path: String,
        result: Result<u64, String>,
    ) -> ApiResult<DirectorySizeRecord> {
        let stored = match result {
            Ok(size_bytes) => StoredDirectorySizeRecord {
                path: path.clone(),
                size_bytes: Some(size_bytes),
                calculated_at_ms: now_ms(),
                status: StoredDirectorySizeStatus::Ready,
                error: None,
            },
            Err(error) => StoredDirectorySizeRecord {
                path: path.clone(),
                size_bytes: None,
                calculated_at_ms: now_ms(),
                status: StoredDirectorySizeStatus::Failed,
                error: Some(error),
            },
        };
        let db_path = self.inner.db_path.clone();
        let db_lock = self.inner.db_lock.clone();
        let stored_for_db = stored.clone();
        tokio::task::spawn_blocking(move || {
            let _guard = lock_db(&db_lock)?;
            save_record(&db_path, &stored_for_db)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Directory size worker failed: {err}")))??;
        Ok(record_for_path(&path, Some(&stored), false, now_ms()))
    }
}

fn record_for_path(
    path: &str,
    stored: Option<&StoredDirectorySizeRecord>,
    calculating: bool,
    now: i64,
) -> DirectorySizeRecord {
    if calculating {
        return DirectorySizeRecord {
            path: path.to_string(),
            size_bytes: stored.and_then(|record| record.size_bytes),
            status: DirectorySizeStatus::Calculating,
            calculated_at_ms: stored.map(|record| record.calculated_at_ms),
            error: None,
        };
    }
    let Some(stored) = stored else {
        return DirectorySizeRecord {
            path: path.to_string(),
            size_bytes: None,
            status: DirectorySizeStatus::Unknown,
            calculated_at_ms: None,
            error: None,
        };
    };
    if now.saturating_sub(stored.calculated_at_ms) > DIRECTORY_SIZE_CACHE_TTL_MS {
        return DirectorySizeRecord {
            path: path.to_string(),
            size_bytes: None,
            status: DirectorySizeStatus::Unknown,
            calculated_at_ms: Some(stored.calculated_at_ms),
            error: None,
        };
    }
    match stored.status {
        StoredDirectorySizeStatus::Ready => DirectorySizeRecord {
            path: path.to_string(),
            size_bytes: stored.size_bytes,
            status: DirectorySizeStatus::Ready,
            calculated_at_ms: Some(stored.calculated_at_ms),
            error: None,
        },
        StoredDirectorySizeStatus::Failed => DirectorySizeRecord {
            path: path.to_string(),
            size_bytes: None,
            status: DirectorySizeStatus::Failed,
            calculated_at_ms: Some(stored.calculated_at_ms),
            error: stored.error.clone(),
        },
    }
}

fn open_db(path: &Path) -> ApiResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| ApiError::Message(format!("Failed to create ~/.misty/db: {err}")))?;
    }
    let conn = Connection::open(path).map_err(sql_error)?;
    conn.busy_timeout(Duration::from_millis(10_000))
        .map_err(sql_error)?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(sql_error)?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(sql_error)?;
    initialize_schema(&conn)?;
    Ok(conn)
}

fn initialize_schema(conn: &Connection) -> ApiResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS directory_sizes (
            path TEXT PRIMARY KEY,
            size_bytes INTEGER,
            status TEXT NOT NULL,
            calculated_at_ms INTEGER NOT NULL,
            error TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_directory_sizes_status
            ON directory_sizes(status, calculated_at_ms DESC);",
    )
    .map_err(sql_error)
}

fn lock_db(lock: &Mutex<()>) -> ApiResult<std::sync::MutexGuard<'_, ()>> {
    lock.lock().map_err(|_| {
        ApiError::Message("SQLite directory size store lock was poisoned.".to_string())
    })
}

fn load_records(
    db_path: &Path,
    paths: &[String],
) -> ApiResult<std::collections::HashMap<String, StoredDirectorySizeRecord>> {
    let conn = open_db(db_path)?;
    let mut records = std::collections::HashMap::new();
    for path in paths {
        if let Some(record) = load_record_with_connection(&conn, path)? {
            records.insert(path.clone(), record);
        }
    }
    Ok(records)
}

fn load_record(db_path: &Path, path: &str) -> ApiResult<Option<StoredDirectorySizeRecord>> {
    let conn = open_db(db_path)?;
    load_record_with_connection(&conn, path)
}

fn load_record_with_connection(
    conn: &Connection,
    path: &str,
) -> ApiResult<Option<StoredDirectorySizeRecord>> {
    conn.query_row(
        "SELECT path, size_bytes, status, calculated_at_ms, error
         FROM directory_sizes
         WHERE path = ?1",
        params![path],
        read_record,
    )
    .optional()
    .map_err(sql_error)
}

fn save_record(db_path: &Path, record: &StoredDirectorySizeRecord) -> ApiResult<()> {
    let conn = open_db(db_path)?;
    conn.execute(
        "INSERT INTO directory_sizes(path, size_bytes, status, calculated_at_ms, error)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(path) DO UPDATE SET
            size_bytes = excluded.size_bytes,
            status = excluded.status,
            calculated_at_ms = excluded.calculated_at_ms,
            error = excluded.error",
        params![
            record.path,
            record
                .size_bytes
                .map(|value| value.min(i64::MAX as u64) as i64),
            stored_status_label(record.status),
            record.calculated_at_ms,
            record.error.as_deref().unwrap_or_default(),
        ],
    )
    .map(|_| ())
    .map_err(sql_error)
}

fn read_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredDirectorySizeRecord> {
    let status = match row.get::<_, String>(2)?.as_str() {
        "ready" => StoredDirectorySizeStatus::Ready,
        "failed" => StoredDirectorySizeStatus::Failed,
        _ => StoredDirectorySizeStatus::Failed,
    };
    Ok(StoredDirectorySizeRecord {
        path: row.get(0)?,
        size_bytes: row
            .get::<_, Option<i64>>(1)?
            .map(|value| value.max(0) as u64),
        status,
        calculated_at_ms: row.get(3)?,
        error: row
            .get::<_, String>(4)
            .ok()
            .filter(|value| !value.trim().is_empty()),
    })
}

fn stored_status_label(status: StoredDirectorySizeStatus) -> &'static str {
    match status {
        StoredDirectorySizeStatus::Ready => "ready",
        StoredDirectorySizeStatus::Failed => "failed",
    }
}

fn sql_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("SQLite directory size store failed: {error}"))
}

fn local_directory_size(path: &Path, home_dir: &Path) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to inspect {}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{} is not a directory.", path.display()));
    }
    if is_background_scan_excluded(path, home_dir) {
        return Err("Folder size is unavailable for protected macOS app data.".to_owned());
    }
    let mut total = 0u64;
    for entry in WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !is_background_scan_excluded(entry.path(), home_dir))
        .skip(1)
    {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_type().is_file() {
            total =
                total.saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
        }
    }
    Ok(total)
}

fn remote_size_from_value(value: &Value) -> Option<u64> {
    if let Some(number) = value.as_u64() {
        return Some(number);
    }
    [
        "sizeBytes",
        "size_bytes",
        "bytes",
        "totalBytes",
        "total_bytes",
        "size",
    ]
    .iter()
    .find_map(|key| value.get(*key).and_then(Value::as_u64))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn directory_size_local_walk_ignores_symlinks() {
        let root = std::env::temp_dir().join(format!("misty-directory-size-{}", Uuid::new_v4()));
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("create test dirs");
        fs::write(root.join("a.txt"), vec![0u8; 7]).expect("write file");
        fs::write(nested.join("b.txt"), vec![0u8; 11]).expect("write nested file");
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("a.txt"), root.join("link.txt")).expect("symlink");

        let size = local_directory_size(&root, &root).expect("directory size");
        assert_eq!(size, 18);

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn directory_size_local_walk_skips_protected_app_data() {
        let home =
            std::env::temp_dir().join(format!("misty-directory-size-privacy-{}", Uuid::new_v4()));
        let protected = home
            .join("Library")
            .join("Containers")
            .join("com.example.private")
            .join("Data");
        fs::create_dir_all(&protected).expect("create protected test dirs");
        fs::write(home.join("visible.txt"), vec![0u8; 7]).expect("write visible file");
        fs::write(protected.join("private.txt"), vec![0u8; 11]).expect("write private file");

        let size = local_directory_size(&home, &home).expect("directory size");
        assert_eq!(size, 7);

        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn directory_size_remote_response_accepts_common_byte_fields() {
        assert_eq!(
            remote_size_from_value(&serde_json::json!({ "sizeBytes": 42 })),
            Some(42)
        );
        assert_eq!(
            remote_size_from_value(&serde_json::json!({ "bytes": 7 })),
            Some(7)
        );
        assert_eq!(remote_size_from_value(&serde_json::json!(9)), Some(9));
    }

    #[test]
    fn directory_size_stale_cache_returns_unknown() {
        let path = "/tmp/example";
        let stored = StoredDirectorySizeRecord {
            path: path.to_string(),
            size_bytes: Some(12),
            calculated_at_ms: 1,
            status: StoredDirectorySizeStatus::Ready,
            error: None,
        };
        let record = record_for_path(path, Some(&stored), false, DIRECTORY_SIZE_CACHE_TTL_MS + 2);
        assert_eq!(record.status, DirectorySizeStatus::Unknown);
        assert_eq!(record.size_bytes, None);
    }

    #[test]
    fn directory_size_sqlite_store_round_trips_record() {
        let root = std::env::temp_dir().join(format!("misty-directory-size-db-{}", Uuid::new_v4()));
        let db_path = root.join("misty.db");
        let record = StoredDirectorySizeRecord {
            path: "/tmp/example".to_string(),
            size_bytes: Some(123),
            calculated_at_ms: 456,
            status: StoredDirectorySizeStatus::Ready,
            error: None,
        };
        save_record(&db_path, &record).expect("save record");
        let loaded = load_record(&db_path, "/tmp/example")
            .expect("load record")
            .expect("record exists");
        assert_eq!(loaded.size_bytes, Some(123));
        assert_eq!(loaded.status, StoredDirectorySizeStatus::Ready);

        let _ = fs::remove_dir_all(root);
    }
}
