use tokio::sync::Mutex;

use super::{
    FileSyncAction, FileSyncChange, FileSyncConflict, FileSyncContext, FileSyncEntryStore,
    FileSyncFinalEvent, FileSyncLocalEntry, FileSyncPolicy, FileSyncRemoteEntry, FileSyncResult,
};
use crate::infra::storage::StorageService;

pub trait FileSyncPolicyEvaluator: Send + Sync {
    fn result(&self, context: &FileSyncContext<'_>) -> FileSyncResult;
}

pub struct RemoteFirstPolicy;
pub struct LocalFirstPolicy;
pub struct BiDirectionalPolicy;

impl FileSyncPolicyEvaluator for RemoteFirstPolicy {
    fn result(&self, context: &FileSyncContext<'_>) -> FileSyncResult {
        if context.event.change == FileSyncChange::Noop {
            return FileSyncResult::default();
        }
        if is_remote_change(context.event.change)
            && has_remote(context)
            && !has_local(context)
            && context.sync_entry.is_none()
        {
            return FileSyncResult::default();
        }
        if has_remote(context) {
            return make_result(
                FileSyncAction::DownloadRemote,
                if local_changed(context) {
                    FileSyncConflict::LocalTmp
                } else {
                    FileSyncConflict::None
                },
            );
        }
        if context.sync_entry.is_some() && has_local(context) {
            return make_result(FileSyncAction::UploadLocal, FileSyncConflict::None);
        }
        FileSyncResult::default()
    }
}

impl FileSyncPolicyEvaluator for LocalFirstPolicy {
    fn result(&self, context: &FileSyncContext<'_>) -> FileSyncResult {
        if context.event.change == FileSyncChange::Noop {
            return FileSyncResult::default();
        }
        if !has_local(context) {
            return if context.sync_entry.is_some() {
                make_result(FileSyncAction::DeleteRemote, FileSyncConflict::None)
            } else {
                FileSyncResult::default()
            };
        }
        make_result(
            local_action(context.event),
            if remote_changed(context) {
                FileSyncConflict::RemoteTmp
            } else {
                FileSyncConflict::None
            },
        )
    }
}

impl FileSyncPolicyEvaluator for BiDirectionalPolicy {
    fn result(&self, context: &FileSyncContext<'_>) -> FileSyncResult {
        if context.event.change == FileSyncChange::Noop {
            return FileSyncResult::default();
        }
        let local = local_changed(context);
        let remote = remote_changed(context);
        if remote && !local && !has_local(context) && context.sync_entry.is_none() {
            return FileSyncResult::default();
        }
        if local && remote {
            return make_result(FileSyncAction::Conflict, FileSyncConflict::None);
        }
        if local {
            return make_result(local_action(context.event), FileSyncConflict::None);
        }
        if remote {
            return make_result(FileSyncAction::DownloadRemote, FileSyncConflict::None);
        }
        FileSyncResult::default()
    }
}

pub struct FileSyncGate {
    mode: FileSyncPolicy,
    policy: Box<dyn FileSyncPolicyEvaluator>,
    entries: FileSyncEntryStore,
    serial: Mutex<()>,
}

impl FileSyncGate {
    pub fn new(mode: FileSyncPolicy, proxy: Option<StorageService>) -> Self {
        Self {
            mode,
            policy: policy(mode),
            entries: FileSyncEntryStore::new(proxy),
            serial: Mutex::new(()),
        }
    }

    pub fn mode(&self) -> FileSyncPolicy {
        self.mode
    }

    pub fn entries(&self) -> &FileSyncEntryStore {
        &self.entries
    }

    pub async fn result(&self, event: &FileSyncFinalEvent) -> FileSyncResult {
        let _guard = self.serial.lock().await;
        let context = self.context(event).await;
        self.policy.result(&context)
    }

    pub async fn record(&self, event: &FileSyncFinalEvent) {
        if !event.result.update_entry {
            return;
        }
        let _guard = self.serial.lock().await;
        self.entries.record(event).await;
    }

    pub async fn reset(&self) {
        let _guard = self.serial.lock().await;
        self.entries.reset().await;
    }

    async fn context<'a>(&self, event: &'a FileSyncFinalEvent) -> FileSyncContext<'a> {
        let id = self.entries.entry(event).await;
        if is_remote_change(event.change) {
            self.entries
                .put_remote(FileSyncRemoteEntry {
                    entry_id: id.clone(),
                    remote_name: event.remote_name.clone(),
                    remote_path: event.pending_event.new_path.clone(),
                    provider_file_id: event.data.provider_file_id.clone(),
                    exists: !matches!(
                        event.change,
                        FileSyncChange::RemoteDelete | FileSyncChange::Noop
                    ),
                    is_dir: event.data.is_dir,
                    size: event.data.size,
                    created: event.data.created.clone(),
                    last_modified: event.data.mtime.clone(),
                    checksum: event.data.content_hash.clone(),
                    observed_at: String::new(),
                })
                .await;
        } else {
            self.entries
                .put_local(FileSyncLocalEntry {
                    entry_id: id.clone(),
                    local_path: event.pending_event.new_path.clone(),
                    exists: !matches!(
                        event.change,
                        FileSyncChange::LocalDelete | FileSyncChange::Noop
                    ),
                    is_dir: event.data.is_dir,
                    size: event.data.size,
                    mtime: event.data.mtime.clone(),
                    checksum: event.data.content_hash.clone(),
                    observed_at: String::new(),
                })
                .await;
        }
        FileSyncContext {
            event,
            local_entry: self.entries.local(&id).await,
            remote_entry: self.entries.remote(&id).await,
            sync_entry: self.entries.sync(&id).await,
        }
    }
}

impl Default for FileSyncGate {
    fn default() -> Self {
        Self::new(FileSyncPolicy::BiDirectional, None)
    }
}

fn policy(mode: FileSyncPolicy) -> Box<dyn FileSyncPolicyEvaluator> {
    match mode {
        FileSyncPolicy::RemoteFirst => Box::new(RemoteFirstPolicy),
        FileSyncPolicy::LocalFirst => Box::new(LocalFirstPolicy),
        FileSyncPolicy::BiDirectional => Box::new(BiDirectionalPolicy),
    }
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

fn has_local(context: &FileSyncContext<'_>) -> bool {
    context
        .local_entry
        .as_ref()
        .is_some_and(|entry| entry.exists)
}

fn has_remote(context: &FileSyncContext<'_>) -> bool {
    context
        .remote_entry
        .as_ref()
        .is_some_and(|entry| entry.exists)
}

fn same_value(current: &str, previous: &str) -> bool {
    !current.is_empty() && !previous.is_empty() && current == previous
}

fn local_changed(context: &FileSyncContext<'_>) -> bool {
    let Some(local) = context.local_entry.as_ref().filter(|entry| entry.exists) else {
        return false;
    };
    let Some(sync) = &context.sync_entry else {
        return true;
    };
    if !local.checksum.is_empty() || !sync.last_local_checksum.is_empty() {
        return !same_value(&local.checksum, &sync.last_local_checksum);
    }
    if !local.mtime.is_empty() || !sync.last_local_mtime.is_empty() {
        return local.mtime != sync.last_local_mtime;
    }
    local.local_path != sync.last_local_path
}

fn remote_changed(context: &FileSyncContext<'_>) -> bool {
    let Some(remote) = context.remote_entry.as_ref().filter(|entry| entry.exists) else {
        return false;
    };
    let Some(sync) = &context.sync_entry else {
        return true;
    };
    if !remote.checksum.is_empty() || !sync.last_remote_checksum.is_empty() {
        return !same_value(&remote.checksum, &sync.last_remote_checksum);
    }
    if !remote.last_modified.is_empty() || !sync.last_remote_mtime.is_empty() {
        return remote.last_modified != sync.last_remote_mtime;
    }
    remote.remote_path != sync.last_remote_path
}

fn local_action(event: &FileSyncFinalEvent) -> FileSyncAction {
    match event.change {
        FileSyncChange::LocalFile | FileSyncChange::LocalFolder => FileSyncAction::UploadLocal,
        FileSyncChange::LocalDelete => FileSyncAction::DeleteRemote,
        FileSyncChange::LocalRename => FileSyncAction::RenameRemote,
        FileSyncChange::RemoteFile | FileSyncChange::RemoteFolder => FileSyncAction::DownloadRemote,
        FileSyncChange::RemoteDelete => FileSyncAction::DeleteLocal,
        FileSyncChange::RemoteRename => FileSyncAction::RenameLocal,
        FileSyncChange::Noop => FileSyncAction::Noop,
    }
}

fn make_result(action: FileSyncAction, conflict: FileSyncConflict) -> FileSyncResult {
    FileSyncResult {
        action,
        conflict,
        update_entry: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::file_sync::{
        FileSyncData, FileSyncEntry, FileSyncEntryState, FileSyncPendingEvent,
    };

    fn upload_event(path: &str, checksum: &str) -> FileSyncFinalEvent {
        FileSyncFinalEvent {
            change: FileSyncChange::LocalFile,
            pending_event: FileSyncPendingEvent {
                new_path: path.into(),
                ..Default::default()
            },
            data: FileSyncData {
                content_hash: checksum.into(),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    async fn synced_baseline(gate: &FileSyncGate, id: &str, path: &str, checksum: &str) {
        gate.entries()
            .put_local(FileSyncLocalEntry {
                entry_id: id.into(),
                local_path: path.into(),
                exists: true,
                checksum: checksum.into(),
                ..Default::default()
            })
            .await;
        gate.entries()
            .put_remote(FileSyncRemoteEntry {
                entry_id: id.into(),
                remote_name: "remote".into(),
                remote_path: path.into(),
                exists: true,
                checksum: checksum.into(),
                ..Default::default()
            })
            .await;
        gate.entries()
            .put_sync(FileSyncEntry {
                entry_id: id.into(),
                state: FileSyncEntryState::Synchronized,
                last_local_path: path.into(),
                last_local_checksum: checksum.into(),
                last_remote_path: path.into(),
                last_remote_checksum: checksum.into(),
                ..Default::default()
            })
            .await;
    }

    #[tokio::test]
    async fn bidirectional_local_only_uploads() {
        let gate = FileSyncGate::default();
        assert_eq!(
            gate.result(&upload_event("/tmp/local.txt", "local-1"))
                .await
                .action,
            FileSyncAction::UploadLocal
        );
    }

    #[tokio::test]
    async fn bidirectional_both_changed_conflicts() {
        let gate = FileSyncGate::default();
        synced_baseline(&gate, "stable", "/tmp/both.txt", "base").await;
        gate.entries()
            .put_remote(FileSyncRemoteEntry {
                entry_id: "stable".into(),
                remote_name: "remote".into(),
                remote_path: "/tmp/both.txt".into(),
                exists: true,
                checksum: "remote-new".into(),
                ..Default::default()
            })
            .await;
        let result = gate
            .result(&upload_event("/tmp/both.txt", "local-new"))
            .await;
        assert_eq!(result.action, FileSyncAction::Conflict);
    }

    #[tokio::test]
    async fn local_first_preserves_remote_preview() {
        let gate = FileSyncGate::new(FileSyncPolicy::LocalFirst, None);
        synced_baseline(&gate, "stable", "/tmp/local.txt", "base").await;
        gate.entries()
            .put_remote(FileSyncRemoteEntry {
                entry_id: "stable".into(),
                remote_name: "remote".into(),
                remote_path: "/tmp/local.txt".into(),
                exists: true,
                checksum: "remote-new".into(),
                ..Default::default()
            })
            .await;
        let result = gate
            .result(&upload_event("/tmp/local.txt", "local-new"))
            .await;
        assert_eq!(result.action, FileSyncAction::UploadLocal);
        assert_eq!(result.conflict, FileSyncConflict::RemoteTmp);
    }

    #[tokio::test]
    async fn remote_first_preserves_local_preview() {
        let gate = FileSyncGate::new(FileSyncPolicy::RemoteFirst, None);
        synced_baseline(&gate, "stable", "/tmp/remote.txt", "base").await;
        gate.entries()
            .put_remote(FileSyncRemoteEntry {
                entry_id: "stable".into(),
                remote_name: "remote".into(),
                remote_path: "/tmp/remote.txt".into(),
                exists: true,
                checksum: "remote-new".into(),
                ..Default::default()
            })
            .await;
        let result = gate
            .result(&upload_event("/tmp/remote.txt", "local-new"))
            .await;
        assert_eq!(result.action, FileSyncAction::DownloadRemote);
        assert_eq!(result.conflict, FileSyncConflict::LocalTmp);
    }

    #[tokio::test]
    async fn rename_keeps_stable_id() {
        let gate = FileSyncGate::default();
        synced_baseline(&gate, "stable", "/tmp/before.txt", "base").await;
        let mut event = upload_event("/tmp/after.txt", "after");
        event.change = FileSyncChange::LocalRename;
        event.pending_event.old_path = "/tmp/before.txt".into();
        let result = gate.result(&event).await;
        assert_eq!(result.action, FileSyncAction::RenameRemote);
        assert_eq!(
            gate.entries().local_id("/tmp/after.txt").await.as_deref(),
            Some("stable")
        );
    }
}
