//! Queue operations that involve a connected device. Each item is one request
//! to the device, or a download and/or upload through this device when an item
//! crosses between devices. Conflicts follow the same policies as local items.

use std::sync::atomic::AtomicU64;

use super::*;
use crate::domain::connected_devices::PeerEntryKind;
use crate::infra::connected_devices::{local_tree_size, TransferWatch};

struct PeerProgress {
    bytes: Arc<AtomicU64>,
    done: Arc<AtomicBool>,
    total: u64,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl PeerProgress {
    fn watch<'a>(&'a self, canceled: &'a AtomicBool) -> TransferWatch<'a> {
        TransferWatch {
            bytes: Some(&self.bytes),
            canceled: Some(canceled),
        }
    }

    /// Stops reporting after one final update. A finished transfer shows all
    /// its bytes, including any that came from the download cache.
    async fn finish(mut self, completed: bool) {
        if completed {
            self.bytes.fetch_max(self.total, Ordering::Relaxed);
        }
        self.done.store(true, Ordering::SeqCst);
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

fn is_peer(path: &str) -> bool {
    PeerVirtualPath::is_peer_path(path)
}

fn involves_peer(payload: &QueuedExplorerOperation) -> bool {
    match payload {
        QueuedExplorerOperation::Create(request) => is_peer(&request.directory),
        QueuedExplorerOperation::Rename(request) => is_peer(&request.path),
        QueuedExplorerOperation::Delete(request) => request.paths.iter().any(|path| is_peer(path)),
        QueuedExplorerOperation::Paste(request) => {
            is_peer(&request.destination_directory)
                || request.sources.iter().any(|source| is_peer(&source.path))
        }
        QueuedExplorerOperation::ArchiveCreate(request) => {
            is_peer(&request.destination_path) || request.paths.iter().any(|path| is_peer(path))
        }
    }
}

impl OperationQueueService {
    fn connected_devices(&self) -> ApiResult<&ConnectedDevicesService> {
        self.peers
            .as_ref()
            .ok_or_else(|| ApiError::Unavailable("Connected devices are not available.".to_owned()))
    }

    pub(super) async fn peer_is_directory(&self, path: &str) -> ApiResult<Option<bool>> {
        Ok(self
            .connected_devices()?
            .stat_item(path)
            .await?
            .map(|entry| matches!(entry.kind, PeerEntryKind::Directory)))
    }

    async fn exists_anywhere(&self, path: &str) -> ApiResult<bool> {
        Ok(self.is_directory_at(path).await?.is_some())
    }

    async fn delete_anywhere(&self, path: &str, cancellation: Arc<AtomicBool>) -> ApiResult<()> {
        if is_peer(path) {
            return self.connected_devices()?.delete_item(path, true).await;
        }
        self.explorer
            .delete_items_with_cancellation(
                DeleteItemsRequest {
                    paths: vec![path.to_owned()],
                    permanent: true,
                },
                cancellation,
            )
            .await
            .map(|_| ())
    }

    /// `None` when the operation involves no connected device.
    pub(super) async fn execute_peer(
        &self,
        operation: &OperationDescriptor,
        payload: &QueuedExplorerOperation,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<Option<ExecutionOutcome>> {
        if !involves_peer(payload) {
            return Ok(None);
        }
        let peers = self.connected_devices()?;
        match payload {
            QueuedExplorerOperation::Create(request) => {
                let destination = child_path(&request.directory, &request.name);
                if !operation_is_tree_descendant(operation) {
                    if let Some(outcome) = self
                        .resolve_peer_target_conflict(operation, &destination, cancellation.clone())
                        .await?
                    {
                        return Ok(Some(outcome));
                    }
                }
                peers
                    .create_item(
                        &request.directory,
                        &request.name,
                        matches!(request.kind, CreateItemKind::Folder),
                    )
                    .await?;
            }
            QueuedExplorerOperation::Rename(request) => {
                let destination = child_path(&parent_path(&request.path), &request.new_name);
                if destination != request.path {
                    if let Some(outcome) = self
                        .resolve_peer_target_conflict(operation, &destination, cancellation.clone())
                        .await?
                    {
                        return Ok(Some(outcome));
                    }
                }
                peers.rename_item(&request.path, &request.new_name).await?;
            }
            QueuedExplorerOperation::Delete(request) => {
                for path in &request.paths {
                    ensure_not_canceled(&cancellation)?;
                    if is_peer(path) {
                        peers.delete_item(path, request.permanent).await?;
                    } else {
                        self.explorer
                            .delete_items_with_cancellation(
                                DeleteItemsRequest {
                                    paths: vec![path.clone()],
                                    permanent: request.permanent,
                                },
                                cancellation.clone(),
                            )
                            .await?;
                    }
                }
            }
            QueuedExplorerOperation::Paste(request) => {
                return self
                    .execute_peer_paste(operation, request.clone(), cancellation)
                    .await
                    .map(Some);
            }
            QueuedExplorerOperation::ArchiveCreate(_) => {
                return Err(ApiError::Message(
                    "Archives can't include items on a connected device yet. Copy them here first."
                        .to_owned(),
                ));
            }
        }
        ensure_not_canceled(&cancellation)?;
        Ok(Some(ExecutionOutcome::Completed))
    }

    /// Create and rename: the same policies as `resolve_target_conflict`.
    async fn resolve_peer_target_conflict(
        &self,
        operation: &OperationDescriptor,
        destination: &str,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<Option<ExecutionOutcome>> {
        ensure_not_canceled(&cancellation)?;
        if !self.exists_anywhere(destination).await? {
            return Ok(None);
        }
        match operation.conflict_policy {
            ConflictPolicy::Ask => self.wait_for_peer_conflict(operation.operation_id).await,
            ConflictPolicy::Replace => {
                self.delete_anywhere(destination, cancellation).await?;
                Ok(None)
            }
            ConflictPolicy::Skip => Ok(Some(ExecutionOutcome::Skipped)),
            ConflictPolicy::KeepBoth => Err(ApiError::Message(
                "Keep Both is not available for create or rename operations.".to_string(),
            )),
        }
    }

    async fn wait_for_peer_conflict(
        &self,
        operation_id: u64,
    ) -> ApiResult<Option<ExecutionOutcome>> {
        if !self.queue.wait_for_conflict(operation_id).await {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} could not wait for conflict resolution."
            )));
        }
        Ok(Some(ExecutionOutcome::WaitingForConflict))
    }

    async fn execute_peer_paste(
        &self,
        operation: &OperationDescriptor,
        request: PasteItemsRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExecutionOutcome> {
        let peers = self.connected_devices()?;
        let source = request
            .sources
            .first()
            .cloned()
            .ok_or_else(|| ApiError::Message("Nothing to copy.".to_owned()))?;
        let keep_source = matches!(request.operation, ClipboardOperation::Copy);
        let mut name = request
            .target_name
            .clone()
            .or_else(|| leaf_name(&source.path))
            .ok_or_else(|| {
                ApiError::Message(format!(
                    "Could not determine file name for {}.",
                    source.path
                ))
            })?;
        let directory = request.destination_directory.clone();

        if !operation_is_tree_descendant(operation) {
            let destination = child_path(&directory, &name);
            if self.exists_anywhere(&destination).await? {
                match operation.conflict_policy {
                    ConflictPolicy::Ask => {
                        return self
                            .wait_for_peer_conflict(operation.operation_id)
                            .await
                            .map(|outcome| {
                                outcome.unwrap_or(ExecutionOutcome::WaitingForConflict)
                            });
                    }
                    ConflictPolicy::Skip => return Ok(ExecutionOutcome::Skipped),
                    ConflictPolicy::Replace => {
                        if destination == source.path {
                            return Err(ApiError::Message(
                                "Cannot replace an item with itself.".to_string(),
                            ));
                        }
                        self.delete_anywhere(&destination, cancellation.clone())
                            .await?;
                    }
                    ConflictPolicy::KeepBoth => {
                        name = self
                            .available_peer_keep_both_name(&directory, &name, &cancellation)
                            .await?;
                    }
                }
            }
        }
        ensure_not_canceled(&cancellation)?;

        let source_on_peer = is_peer(&source.path);
        let destination_on_peer = is_peer(&directory);
        let same_device = source_on_peer
            && destination_on_peer
            && PeerVirtualPath::parse(&source.path)?.device_id
                == PeerVirtualPath::parse(&directory)?.device_id;
        if same_device {
            peers
                .transfer_item(&source.path, &directory, &name, keep_source)
                .await?;
            return Ok(ExecutionOutcome::Completed);
        }

        // Between devices the bytes pass through this one, so it can count them:
        // a download, an upload, or both for a copy from one device to another.
        let total = if source_on_peer {
            peers.remote_tree_size(&source.path).await.unwrap_or(0)
        } else {
            local_tree_size(Path::new(&source.path)).await
        };
        let phases = if source_on_peer && destination_on_peer {
            2
        } else {
            1
        };
        let progress = self.start_peer_progress(operation.transfer_id, total * phases);
        let watch = progress.watch(&cancellation);
        let moved = async {
            if source_on_peer {
                let materialized = peers.materialize_tree_with(&source.path, watch).await?;
                watch.check()?;
                if destination_on_peer {
                    peers
                        .upload_tree(&materialized.local_path, &directory, &name, watch)
                        .await?;
                } else {
                    // The download already sits on this device; moving it out of
                    // the cache places it without copying the bytes again.
                    self.explorer
                        .paste_items_with_cancellation(
                            PasteItemsRequest {
                                sources: vec![PasteItem {
                                    path: materialized.local_path.to_string_lossy().into_owned(),
                                    is_directory: source.is_directory,
                                    size_bytes: source.size_bytes,
                                    remote_modified: None,
                                }],
                                destination_directory: directory.clone(),
                                operation: ClipboardOperation::Move,
                                target_name: Some(name.clone()),
                            },
                            cancellation.clone(),
                        )
                        .await?;
                }
                if !keep_source {
                    peers.delete_item(&source.path, true).await?;
                }
            } else {
                peers
                    .upload_tree(Path::new(&source.path), &directory, &name, watch)
                    .await?;
                if !keep_source {
                    self.explorer
                        .delete_items_with_cancellation(
                            DeleteItemsRequest {
                                paths: vec![source.path.clone()],
                                permanent: true,
                            },
                            cancellation.clone(),
                        )
                        .await?;
                }
            }
            ensure_not_canceled(&cancellation)
        }
        .await;
        progress.finish(moved.is_ok()).await;
        moved.map(|()| ExecutionOutcome::Completed)
    }

    /// Reports a connected-device transfer's bytes to its transfer record four
    /// times a second, as local copies do.
    fn start_peer_progress(&self, transfer_id: u64, total: u64) -> PeerProgress {
        let bytes = Arc::new(AtomicU64::new(0));
        let done = Arc::new(AtomicBool::new(false));
        let task = (transfer_id > 0).then(|| {
            let transfers = self.transfers.clone();
            let (bytes, done) = (bytes.clone(), done.clone());
            tokio::spawn(async move {
                let started = std::time::Instant::now();
                loop {
                    let finished = done.load(Ordering::SeqCst);
                    let copied = i64::try_from(bytes.load(Ordering::Relaxed)).unwrap_or(i64::MAX);
                    let total = i64::try_from(total).unwrap_or(i64::MAX).max(copied);
                    let speed = copied as f64 / started.elapsed().as_secs_f64().max(0.001);
                    let _ = transfers
                        .update_progress_with_speed(transfer_id, copied, total, speed)
                        .await;
                    if finished {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                }
            })
        });
        PeerProgress {
            bytes,
            done,
            total,
            task,
        }
    }

    async fn available_peer_keep_both_name(
        &self,
        directory: &str,
        name: &str,
        cancellation: &AtomicBool,
    ) -> ApiResult<String> {
        for index in 1..10_000 {
            ensure_not_canceled(cancellation)?;
            let candidate = keep_both_candidate(Path::new(name), index)?
                .to_string_lossy()
                .into_owned();
            if !self
                .exists_anywhere(&child_path(directory, &candidate))
                .await?
            {
                return Ok(candidate);
            }
        }
        Err(ApiError::Message(format!(
            "Could not create a unique name for {name}."
        )))
    }
}
