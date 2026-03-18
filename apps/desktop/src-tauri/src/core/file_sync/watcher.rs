use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
    time::Duration,
};

use tokio::{sync::watch, task::JoinHandle};

use crate::error::{ApiError, ApiResult};

use super::{FsEvent, FsEventEffect};

#[derive(Debug, Clone, PartialEq, Eq)]
struct LocalFingerprint {
    is_dir: bool,
    size: u64,
    modified_ms: u128,
}

type LocalSnapshot = BTreeMap<String, LocalFingerprint>;

/// Recursive local filesystem watcher. It uses a compact metadata snapshot so the
/// sync engine remains portable and all directory work stays on the blocking pool.
pub struct FileSyncWatcher {
    stop: Option<watch::Sender<bool>>,
    task: Option<JoinHandle<()>>,
}

impl FileSyncWatcher {
    pub fn new() -> Self {
        Self {
            stop: None,
            task: None,
        }
    }

    pub fn running(&self) -> bool {
        self.task.as_ref().is_some_and(|task| !task.is_finished())
    }

    pub fn start<F>(&mut self, root: PathBuf, interval: Duration, callback: F) -> ApiResult<()>
    where
        F: Fn(Vec<FsEvent>) + Send + Sync + 'static,
    {
        self.stop();
        if !root.is_dir() {
            return Err(ApiError::Message(format!(
                "Sync watch root is not a directory: {}",
                root.display()
            )));
        }
        if interval.is_zero() {
            return Err(ApiError::Message("Watch interval must be positive.".into()));
        }

        let (stop_tx, mut stop_rx) = watch::channel(false);
        self.stop = Some(stop_tx);
        self.task = Some(tokio::spawn(async move {
            let mut previous = scan_local(root.clone()).await.unwrap_or_default();
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {
                        let Ok(current) = scan_local(root.clone()).await else { continue };
                        let events = diff_local_snapshots(&previous, &current);
                        previous = current;
                        if !events.is_empty() {
                            callback(events);
                        }
                    }
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() { break; }
                    }
                }
            }
        }));
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(true);
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

impl Drop for FileSyncWatcher {
    fn drop(&mut self) {
        self.stop();
    }
}

async fn scan_local(root: PathBuf) -> ApiResult<LocalSnapshot> {
    tokio::task::spawn_blocking(move || scan_local_blocking(&root))
        .await
        .map_err(|error| ApiError::Message(format!("Sync watcher failed: {error}")))?
}

fn scan_local_blocking(root: &Path) -> ApiResult<LocalSnapshot> {
    let mut snapshot = LocalSnapshot::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = std::fs::read_dir(&directory).map_err(|error| {
            ApiError::Message(format!("Unable to scan {}: {error}", directory.display()))
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| ApiError::Message(error.to_string()))?;
            if ignored_path(&entry.path()) {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|error| ApiError::Message(error.to_string()))?;
            let path = entry.path().to_string_lossy().to_string();
            let fingerprint = LocalFingerprint {
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified_ms: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis())
                    .unwrap_or_default(),
            };
            if fingerprint.is_dir {
                pending.push(entry.path());
            }
            snapshot.insert(path, fingerprint);
        }
    }
    Ok(snapshot)
}

fn diff_local_snapshots(previous: &LocalSnapshot, current: &LocalSnapshot) -> Vec<FsEvent> {
    let created: Vec<_> = current
        .iter()
        .filter(|(path, _)| !previous.contains_key(*path))
        .collect();
    let deleted: Vec<_> = previous
        .iter()
        .filter(|(path, _)| !current.contains_key(*path))
        .collect();
    let mut consumed_created = HashSet::new();
    let mut consumed_deleted = HashSet::new();
    let mut events = Vec::new();

    // Infer a rename only for a unique metadata match; ambiguous matches remain
    // independent create/delete events and are therefore never silently merged.
    for (old_path, old_fingerprint) in &deleted {
        let matches: Vec<_> = created
            .iter()
            .filter(|(new_path, fingerprint)| {
                !consumed_created.contains(*new_path) && *fingerprint == *old_fingerprint
            })
            .collect();
        if matches.len() == 1 {
            let (new_path, _) = matches[0];
            consumed_deleted.insert((*old_path).clone());
            consumed_created.insert((*new_path).clone());
            events.push(FsEvent {
                old_path: (*old_path).clone(),
                new_path: (*new_path).clone(),
                effect: FsEventEffect::Renamed,
            });
        }
    }

    for (path, fingerprint) in current {
        match previous.get(path) {
            Some(old) if old != fingerprint => events.push(FsEvent {
                new_path: path.clone(),
                old_path: String::new(),
                effect: FsEventEffect::Modified,
            }),
            None if !consumed_created.contains(path) => events.push(FsEvent {
                new_path: path.clone(),
                old_path: String::new(),
                effect: FsEventEffect::Created,
            }),
            _ => {}
        }
    }
    for (path, _) in previous {
        if !current.contains_key(path) && !consumed_deleted.contains(path) {
            events.push(FsEvent {
                new_path: path.clone(),
                old_path: String::new(),
                effect: FsEventEffect::Deleted,
            });
        }
    }
    events
}

fn ignored_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let lower = name.to_ascii_lowercase();
    name == ".DS_Store"
        || name.starts_with("._")
        || name.starts_with("~$")
        || lower.ends_with(".swp")
        || lower.ends_with(".swo")
        || lower.ends_with(".tmp")
        || lower.ends_with(".temp")
        || lower.ends_with('~')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(is_dir: bool, size: u64, modified_ms: u128) -> LocalFingerprint {
        LocalFingerprint {
            is_dir,
            size,
            modified_ms,
        }
    }

    #[test]
    fn diff_reports_create_modify_delete() {
        let previous = BTreeMap::from([
            ("/a".into(), item(false, 1, 1)),
            ("/b".into(), item(false, 2, 1)),
        ]);
        let current = BTreeMap::from([
            ("/a".into(), item(false, 3, 2)),
            ("/c".into(), item(false, 4, 2)),
        ]);
        let events = diff_local_snapshots(&previous, &current);
        assert!(events
            .iter()
            .any(|event| event.new_path == "/a" && event.effect == FsEventEffect::Modified));
        assert!(events
            .iter()
            .any(|event| event.new_path == "/b" && event.effect == FsEventEffect::Deleted));
        assert!(events
            .iter()
            .any(|event| event.new_path == "/c" && event.effect == FsEventEffect::Created));
    }

    #[test]
    fn diff_infers_unambiguous_rename() {
        let previous = BTreeMap::from([("/old".into(), item(false, 7, 10))]);
        let current = BTreeMap::from([("/new".into(), item(false, 7, 10))]);
        assert_eq!(
            diff_local_snapshots(&previous, &current),
            vec![FsEvent {
                old_path: "/old".into(),
                new_path: "/new".into(),
                effect: FsEventEffect::Renamed,
            }]
        );
    }
}
