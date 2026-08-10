use std::{
    collections::{BTreeMap, HashMap},
    future::Future,
    pin::Pin,
    sync::Arc,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::{sync::watch, task::JoinHandle};

use crate::error::ApiResult;

use super::{FileSyncChange, FileSyncRemoteEntry};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncRemoteTarget {
    pub remote_name: String,
    pub remote_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncRemoteEvent {
    pub change: FileSyncChange,
    pub entry: FileSyncRemoteEntry,
    pub old_remote_path: String,
}

pub type FileSyncRemoteScanFuture =
    Pin<Box<dyn Future<Output = ApiResult<Vec<FileSyncRemoteEntry>>> + Send>>;
pub type FileSyncRemoteScanner =
    Arc<dyn Fn(FileSyncRemoteTarget) -> FileSyncRemoteScanFuture + Send + Sync>;

pub struct FileSyncRemotePoller {
    stop: Option<watch::Sender<bool>>,
    task: Option<JoinHandle<()>>,
}

impl FileSyncRemotePoller {
    pub fn new() -> Self {
        Self {
            stop: None,
            task: None,
        }
    }

    pub fn running(&self) -> bool {
        self.task.as_ref().is_some_and(|task| !task.is_finished())
    }

    pub fn start<F>(
        &mut self,
        targets: Vec<FileSyncRemoteTarget>,
        scanner: FileSyncRemoteScanner,
        interval: Duration,
        callback: F,
    ) -> bool
    where
        F: Fn(Vec<FileSyncRemoteEvent>) + Send + Sync + 'static,
    {
        self.stop();
        if interval.is_zero() {
            return false;
        }
        let (stop_tx, mut stop_rx) = watch::channel(false);
        self.stop = Some(stop_tx);
        self.task = Some(tokio::spawn(async move {
            let mut previous: HashMap<String, BTreeMap<String, FileSyncRemoteEntry>> =
                HashMap::new();
            loop {
                for target in &targets {
                    let Ok(entries) = scanner(target.clone()).await else {
                        continue;
                    };
                    let current = entries
                        .into_iter()
                        .map(|entry| (remote_identity(&entry), entry))
                        .collect::<BTreeMap<_, _>>();
                    let key = format!("{}:{}", target.remote_name, target.remote_path);
                    if let Some(old) = previous.get(&key) {
                        let events = diff_remote_snapshots(old, &current);
                        if !events.is_empty() {
                            callback(events);
                        }
                    }
                    previous.insert(key, current);
                }
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() { break; }
                    }
                }
            }
        }));
        true
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

impl Drop for FileSyncRemotePoller {
    fn drop(&mut self) {
        self.stop();
    }
}

fn diff_remote_snapshots(
    previous: &BTreeMap<String, FileSyncRemoteEntry>,
    current: &BTreeMap<String, FileSyncRemoteEntry>,
) -> Vec<FileSyncRemoteEvent> {
    let mut events = Vec::new();
    for (identity, entry) in current {
        match previous.get(identity) {
            None => events.push(FileSyncRemoteEvent {
                change: change_for_entry(entry),
                entry: entry.clone(),
                old_remote_path: String::new(),
            }),
            Some(old) if old.remote_path != entry.remote_path => events.push(FileSyncRemoteEvent {
                change: FileSyncChange::RemoteRename,
                entry: entry.clone(),
                old_remote_path: old.remote_path.clone(),
            }),
            Some(old) if remote_entry_changed(old, entry) => events.push(FileSyncRemoteEvent {
                change: change_for_entry(entry),
                entry: entry.clone(),
                old_remote_path: String::new(),
            }),
            _ => {}
        }
    }
    for (identity, entry) in previous {
        if !current.contains_key(identity) {
            let mut deleted = entry.clone();
            deleted.exists = false;
            events.push(FileSyncRemoteEvent {
                change: FileSyncChange::RemoteDelete,
                old_remote_path: entry.remote_path.clone(),
                entry: deleted,
            });
        }
    }
    events
}

fn remote_identity(entry: &FileSyncRemoteEntry) -> String {
    if entry.provider_file_id.is_empty() {
        format!("path:{}", entry.remote_path)
    } else {
        format!("provider:{}", entry.provider_file_id)
    }
}

fn remote_entry_changed(old: &FileSyncRemoteEntry, current: &FileSyncRemoteEntry) -> bool {
    old.exists != current.exists
        || old.is_dir != current.is_dir
        || old.size != current.size
        || old.last_modified != current.last_modified
        || old.checksum != current.checksum
}

fn change_for_entry(entry: &FileSyncRemoteEntry) -> FileSyncChange {
    if entry.is_dir {
        FileSyncChange::RemoteFolder
    } else {
        FileSyncChange::RemoteFile
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, provider_id: &str, size: i64) -> FileSyncRemoteEntry {
        FileSyncRemoteEntry {
            remote_name: "drive".into(),
            remote_path: path.into(),
            provider_file_id: provider_id.into(),
            exists: true,
            size,
            ..FileSyncRemoteEntry::default()
        }
    }

    #[test]
    fn diff_detects_provider_identity_rename_and_delete() {
        let previous = BTreeMap::from([
            ("provider:one".into(), entry("/old", "one", 1)),
            ("provider:gone".into(), entry("/gone", "gone", 2)),
        ]);
        let current = BTreeMap::from([("provider:one".into(), entry("/new", "one", 1))]);
        let events = diff_remote_snapshots(&previous, &current);
        assert!(events.iter().any(|event| {
            event.change == FileSyncChange::RemoteRename
                && event.old_remote_path == "/old"
                && event.entry.remote_path == "/new"
        }));
        assert!(events.iter().any(|event| {
            event.change == FileSyncChange::RemoteDelete && event.entry.remote_path == "/gone"
        }));
    }
}
