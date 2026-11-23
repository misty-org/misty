use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::SystemTime,
};

use database::store::Store;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager, Webview};

use super::person_window;

const LIMIT_SCOPE: &str = "files:thumbnail-cache-limit";
const MB: u64 = 1024 * 1024;
pub(crate) const DEFAULT_LIMIT: u64 = 512 * MB;
const MIN_LIMIT: u64 = 16 * MB;
const TRIM_TO_PERCENT: u64 = 90;

static LIMIT: AtomicU64 = AtomicU64::new(0);
static USED: Mutex<Option<u64>> = Mutex::new(None);

pub(crate) struct ThumbnailCache {
    pub dir: PathBuf,
    store: Store,
}

impl ThumbnailCache {
    pub(crate) fn of(app: &AppHandle) -> Option<Self> {
        let runtime = app.try_state::<crate::app::runtime::MistyRuntime>()?;
        Some(Self {
            dir: runtime.environment.cache_dir().join("thumbnails"),
            store: runtime.environment.store(),
        })
    }

    fn limit(&self) -> u64 {
        match LIMIT.load(Ordering::Relaxed) {
            0 => {
                let limit = read_limit(&self.store);
                LIMIT.store(limit, Ordering::Relaxed);
                limit
            }
            limit => limit,
        }
    }

    pub(crate) fn touched(&self, kept: &Path) {
        if let Ok(file) = file_access::fs::OpenOptions::new().write(true).open(kept) {
            let _ = file.set_modified(SystemTime::now());
        }
    }

    pub(crate) fn added(&self, bytes: u64) {
        let mut used = USED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let total = match *used {
            Some(total) => total + bytes,
            None => held(&self.dir).1,
        };
        let limit = self.limit();
        *used = Some(if total > limit {
            trim(&self.dir, limit)
        } else {
            total
        });
    }

    fn status(&self) -> ThumbnailCacheStatus {
        let mut used = USED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let total = held(&self.dir).1;
        *used = Some(total);
        ThumbnailCacheStatus {
            limit: self.limit(),
            used: total,
        }
    }

    fn set_limit(&self, bytes: u64) -> Result<ThumbnailCacheStatus, String> {
        if bytes < MIN_LIMIT {
            return Err("The thumbnail cache has to be at least 16 MB.".into());
        }
        write_limit(&self.store, bytes)?;
        LIMIT.store(bytes, Ordering::Relaxed);
        let mut used = USED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let total = held(&self.dir).1;
        *used = Some(if total > bytes {
            trim(&self.dir, bytes)
        } else {
            total
        });
        Ok(ThumbnailCacheStatus {
            limit: bytes,
            used: used.unwrap_or(0),
        })
    }
}

fn read_limit(store: &Store) -> u64 {
    let saved = store.connect().ok().and_then(|connection| {
        connection
            .query_row(
                "SELECT document FROM settings_state WHERE scope = ?1",
                [LIMIT_SCOPE],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
    });
    saved
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|value| value.as_u64())
        .filter(|limit| *limit >= MIN_LIMIT)
        .unwrap_or(DEFAULT_LIMIT)
}

fn write_limit(store: &Store, bytes: u64) -> Result<(), String> {
    let connection = store
        .connect()
        .map_err(|_| "Misty couldn't read its settings.".to_string())?;
    connection
        .execute(
            "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, ?2)
             ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
            params![LIMIT_SCOPE, bytes.to_string()],
        )
        .map(|_| ())
        .map_err(|_| "Misty couldn't save its settings.".to_string())
}

fn held(dir: &Path) -> (Vec<(SystemTime, u64, PathBuf)>, u64) {
    let Ok(entries) = file_access::fs::read_dir(dir) else {
        return (Vec::new(), 0);
    };
    let mut kept: Vec<(SystemTime, u64, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let meta = entry.metadata().ok()?;
            meta.is_file().then(|| {
                (
                    meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                    meta.len(),
                    entry.path(),
                )
            })
        })
        .collect();
    kept.sort_by_key(|(used, _, _)| *used);
    let total = kept.iter().map(|(_, bytes, _)| bytes).sum();
    (kept, total)
}

fn trim(dir: &Path, limit: u64) -> u64 {
    let (kept, mut total) = held(dir);
    let goal = limit.saturating_mul(TRIM_TO_PERCENT) / 100;
    for (_, bytes, path) in kept {
        if total <= goal {
            break;
        }
        if file_access::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(bytes);
        }
    }
    total
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailCacheStatus {
    pub limit: u64,
    pub used: u64,
}

fn cache(app: &AppHandle) -> Result<ThumbnailCache, String> {
    ThumbnailCache::of(app).ok_or_else(|| "Misty couldn't find its cache folder.".to_string())
}

#[tauri::command]
pub async fn files_thumbnail_cache(
    app: AppHandle,
    webview: Webview,
) -> Result<ThumbnailCacheStatus, String> {
    person_window(&webview)?;
    let cache = cache(&app)?;
    tokio::task::spawn_blocking(move || cache.status())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn files_set_thumbnail_cache_limit(
    app: AppHandle,
    webview: Webview,
    bytes: u64,
) -> Result<ThumbnailCacheStatus, String> {
    person_window(&webview)?;
    let cache = cache(&app)?;
    tokio::task::spawn_blocking(move || cache.set_limit(bytes))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods)]
    use super::*;

    #[test]
    fn a_trim_removes_the_thumbnails_used_longest_ago_first() {
        let dir = std::env::temp_dir().join(format!("misty-thumbnail-trim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let now = SystemTime::now();
        for (index, name) in ["old", "middle", "new"].into_iter().enumerate() {
            let path = dir.join(name);
            std::fs::write(&path, vec![0u8; 100]).unwrap();
            let used = now - std::time::Duration::from_secs(300 - 100 * index as u64);
            file_access::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(used)
                .unwrap();
        }
        assert_eq!(trim(&dir, 230), 200);
        assert!(!dir.join("old").exists());
        assert!(dir.join("middle").exists());
        assert!(dir.join("new").exists());
        assert_eq!(trim(&dir, 100), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
