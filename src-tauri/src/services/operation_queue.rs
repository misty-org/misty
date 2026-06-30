use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use tokio::sync::Mutex;

use crate::core::{
    explorer::{
        ClipboardOperation, CreateItemKind, CreateItemRequest, DeleteItemsRequest, PasteItem,
        PasteItemsRequest, RenameItemRequest, RenameItemsRequest,
    },
    file_master::RemoteBrowseTarget,
    file_transfer::FileTransferRecord,
    file_transfer::{
        FileTransferConflictPolicy, FileTransferItemType, FileTransferStatus, FileTransferType,
    },
    operation_queue::{
        ConflictPolicy, OperationDescriptor, OperationEndpoint, OperationKind, OperationPriority,
        OperationQueue, OperationQueueSnapshot, OperationStatus,
    },
};
use crate::error::{ApiError, ApiResult};
use crate::services::power_pack::{archive_create_blocking, ArchiveCreateRequest};
use crate::services::{explorer::ExplorerService, transfers::TransferService};

#[derive(Clone)]
pub struct OperationQueueService {
    queue: OperationQueue,
    explorer: ExplorerService,
    transfers: TransferService,
    payloads: Arc<Mutex<HashMap<u64, QueuedExplorerOperation>>>,
    cancellations: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
    redo_stack: Arc<Mutex<Vec<FileTransferRecord>>>,
    pumping: Arc<AtomicBool>,
}

#[derive(Clone)]
enum QueuedExplorerOperation {
    Create(CreateItemRequest),
    Rename(RenameItemRequest),
    Delete(DeleteItemsRequest),
    Paste(PasteItemsRequest),
    ArchiveCreate(ArchiveCreateRequest),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExecutionOutcome {
    Completed,
    Skipped,
    WaitingForConflict,
}

impl OperationQueueService {
    pub fn new(explorer: ExplorerService, transfers: TransferService) -> Self {
        Self {
            queue: OperationQueue::new(4),
            explorer,
            transfers,
            payloads: Arc::new(Mutex::new(HashMap::new())),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
            redo_stack: Arc::new(Mutex::new(Vec::new())),
            pumping: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn enqueue_paste_items(
        &self,
        request: PasteItemsRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        if request.sources.is_empty() {
            return Ok(self.snapshot_with_redo_state().await);
        }
        self.enqueue_paste_items_inner(request).await
    }

    async fn enqueue_paste_items_inner(
        &self,
        request: PasteItemsRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        if request.sources.is_empty() {
            return Ok(self.snapshot_with_redo_state().await);
        }

        let mut descriptors = Vec::with_capacity(request.sources.len());
        let mut payloads = Vec::with_capacity(request.sources.len());
        for source in &request.sources {
            let file_name = request
                .target_name
                .as_deref()
                .filter(|_| request.sources.len() == 1)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    Path::new(&source.path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or(&source.path)
                        .to_string()
                });
            let target_path = Path::new(&request.destination_directory)
                .join(&file_name)
                .to_string_lossy()
                .to_string();
            let source_endpoint = self.endpoint_for_path(source.path.clone());
            let target_endpoint = self.endpoint_for_path(target_path);
            let operation_kind =
                operation_kind_for_paste(request.operation, &source_endpoint, &target_endpoint);
            descriptors.push(OperationDescriptor {
                kind: operation_kind,
                source: source_endpoint,
                target: target_endpoint,
                supports_replace: true,
                supports_keep_both: true,
                title: format!("{} {}", operation_action_label(operation_kind), file_name),
                ..OperationDescriptor::default()
            });
            payloads.push(QueuedExplorerOperation::Paste(PasteItemsRequest {
                sources: vec![source.clone()],
                destination_directory: request.destination_directory.clone(),
                operation: request.operation,
                target_name: request
                    .target_name
                    .as_ref()
                    .filter(|_| request.sources.len() == 1)
                    .cloned(),
            }));
        }

        let label = match request.operation {
            ClipboardOperation::Copy => "Copy items",
            ClipboardOperation::Move => "Move items",
        };
        self.clear_redo_stack().await;
        let (_, operation_ids) = self
            .queue
            .enqueue_batch_with_ids(label, false, descriptors)
            .await;
        {
            let mut stored = self.payloads.lock().await;
            for (operation_id, payload) in operation_ids.iter().copied().zip(payloads) {
                stored.insert(operation_id, payload);
            }
        }
        self.schedule_pump();
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn enqueue_create_item(
        &self,
        request: CreateItemRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        let target_path = Path::new(&request.directory)
            .join(&request.name)
            .to_string_lossy()
            .to_string();
        let item_label = match request.kind {
            CreateItemKind::File => "file",
            CreateItemKind::Folder => "folder",
        };
        self.enqueue_operations(
            format!("Create {item_label}"),
            false,
            vec![OperationDescriptor {
                kind: OperationKind::Create,
                target: self.endpoint_for_path(target_path),
                supports_replace: true,
                supports_keep_both: false,
                title: format!("Create {}", request.name),
                ..OperationDescriptor::default()
            }],
            vec![QueuedExplorerOperation::Create(request)],
        )
        .await
    }

    pub async fn enqueue_rename_item(
        &self,
        request: RenameItemRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        self.enqueue_rename_item_inner(request).await
    }

    async fn enqueue_rename_item_inner(
        &self,
        request: RenameItemRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        let target_path = Path::new(&request.path)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(&request.new_name)
            .to_string_lossy()
            .to_string();
        self.enqueue_operations(
            "Rename item",
            false,
            vec![OperationDescriptor {
                kind: OperationKind::Rename,
                source: self.endpoint_for_path(request.path.clone()),
                target: self.endpoint_for_path(target_path),
                supports_replace: true,
                supports_keep_both: false,
                title: format!("Rename to {}", request.new_name),
                ..OperationDescriptor::default()
            }],
            vec![QueuedExplorerOperation::Rename(request)],
        )
        .await
    }

    pub async fn enqueue_rename_items(
        &self,
        request: RenameItemsRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        if request.items.is_empty() {
            return Ok(self.snapshot_with_redo_state().await);
        }
        let mut descriptors = Vec::with_capacity(request.items.len());
        let mut payloads = Vec::with_capacity(request.items.len());
        for item in request.items {
            let target_path = Path::new(&item.path)
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .join(&item.new_name)
                .to_string_lossy()
                .to_string();
            descriptors.push(OperationDescriptor {
                kind: OperationKind::Rename,
                source: self.endpoint_for_path(item.path.clone()),
                target: self.endpoint_for_path(target_path),
                supports_replace: true,
                supports_keep_both: false,
                title: format!("Rename to {}", item.new_name),
                ..OperationDescriptor::default()
            });
            payloads.push(QueuedExplorerOperation::Rename(item));
        }
        self.enqueue_operations("Rename items", true, descriptors, payloads)
            .await
    }

    pub async fn enqueue_delete_items(
        &self,
        request: DeleteItemsRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        if request.paths.is_empty() {
            return Ok(self.snapshot_with_redo_state().await);
        }
        let permanent = request.permanent;
        let mut descriptors = Vec::with_capacity(request.paths.len());
        let mut payloads = Vec::with_capacity(request.paths.len());
        for path in request.paths {
            let name = Path::new(&path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&path)
                .to_string();
            descriptors.push(OperationDescriptor {
                kind: OperationKind::Delete,
                source: self.endpoint_for_path(path.clone()),
                title: if permanent {
                    format!("Delete Permanently {name}")
                } else {
                    format!("Trash {name}")
                },
                ..OperationDescriptor::default()
            });
            payloads.push(QueuedExplorerOperation::Delete(DeleteItemsRequest {
                paths: vec![path],
                permanent,
            }));
        }
        self.enqueue_operations(
            if permanent {
                "Delete items"
            } else {
                "Move items to Trash"
            },
            false,
            descriptors,
            payloads,
        )
        .await
    }

    pub async fn enqueue_archive_create(
        &self,
        request: ArchiveCreateRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        if request.paths.is_empty() {
            return Ok(self.snapshot_with_redo_state().await);
        }
        let archive_name = Path::new(&request.destination_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&request.destination_path)
            .to_string();
        self.enqueue_operations(
            "Create archive",
            false,
            vec![OperationDescriptor {
                kind: OperationKind::Archive,
                source: request
                    .paths
                    .first()
                    .map(|path| self.endpoint_for_path(path.clone()))
                    .unwrap_or_default(),
                target: self.endpoint_for_path(request.destination_path.clone()),
                supports_replace: true,
                supports_keep_both: true,
                title: format!("Compress {archive_name}"),
                ..OperationDescriptor::default()
            }],
            vec![QueuedExplorerOperation::ArchiveCreate(request)],
        )
        .await
    }

    async fn enqueue_operations(
        &self,
        label: impl Into<String>,
        preserve_order: bool,
        descriptors: Vec<OperationDescriptor>,
        payloads: Vec<QueuedExplorerOperation>,
    ) -> ApiResult<OperationQueueSnapshot> {
        Ok(self
            .enqueue_operations_with_ids(label, preserve_order, descriptors, payloads)
            .await?
            .0)
    }

    async fn enqueue_operations_with_ids(
        &self,
        label: impl Into<String>,
        preserve_order: bool,
        mut descriptors: Vec<OperationDescriptor>,
        payloads: Vec<QueuedExplorerOperation>,
    ) -> ApiResult<(OperationQueueSnapshot, Vec<u64>)> {
        if descriptors.len() != payloads.len() {
            return Err(ApiError::Message(
                "Operation descriptors and payloads are out of sync.".to_string(),
            ));
        }
        if descriptors.is_empty() {
            return Ok((self.snapshot_with_redo_state().await, Vec::new()));
        }
        for descriptor in &mut descriptors {
            if matches!(
                descriptor.kind,
                OperationKind::Create | OperationKind::Rename | OperationKind::Archive
            ) {
                let transfer_id = self
                    .transfers
                    .create_transfer(transfer_record_for_operation(descriptor))
                    .await?;
                descriptor.transfer_id = transfer_id;
            }
        }
        self.clear_redo_stack().await;
        let (_, operation_ids) = self
            .queue
            .enqueue_batch_with_ids(label, preserve_order, descriptors)
            .await;
        {
            let mut stored = self.payloads.lock().await;
            for (operation_id, payload) in operation_ids.iter().copied().zip(payloads) {
                stored.insert(operation_id, payload);
            }
        }
        self.schedule_pump();
        Ok((self.snapshot_with_redo_state().await, operation_ids))
    }

    fn endpoint_for_path(&self, path: String) -> OperationEndpoint {
        let remote = self.explorer.remote_target_for_path(&path);
        endpoint_for_path(path, remote)
    }

    pub async fn enqueue_file_sync_apply(
        &self,
        label: impl Into<String>,
        copy_requests: Vec<PasteItemsRequest>,
        delete_paths: Vec<String>,
    ) -> ApiResult<(OperationQueueSnapshot, Vec<u64>)> {
        if copy_requests.is_empty() && delete_paths.is_empty() {
            return Ok((self.snapshot_with_redo_state().await, Vec::new()));
        }
        let mut descriptors = Vec::new();
        let mut payloads = Vec::new();

        for request in copy_requests {
            for source in &request.sources {
                let file_name = request
                    .target_name
                    .as_deref()
                    .filter(|_| request.sources.len() == 1)
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        Path::new(&source.path)
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or(&source.path)
                            .to_string()
                    });
                let target_path = Path::new(&request.destination_directory)
                    .join(&file_name)
                    .to_string_lossy()
                    .to_string();
                let source_endpoint = self.endpoint_for_path(source.path.clone());
                let target_endpoint = self.endpoint_for_path(target_path);
                let operation_kind =
                    operation_kind_for_paste(request.operation, &source_endpoint, &target_endpoint);
                descriptors.push(OperationDescriptor {
                    kind: operation_kind,
                    source: source_endpoint,
                    target: target_endpoint,
                    supports_replace: true,
                    supports_keep_both: true,
                    title: format!("{} {}", operation_action_label(operation_kind), file_name),
                    ..OperationDescriptor::default()
                });
                payloads.push(QueuedExplorerOperation::Paste(PasteItemsRequest {
                    sources: vec![source.clone()],
                    destination_directory: request.destination_directory.clone(),
                    operation: request.operation,
                    target_name: request
                        .target_name
                        .as_ref()
                        .filter(|_| request.sources.len() == 1)
                        .cloned(),
                }));
            }
        }

        for path in delete_paths {
            let name = Path::new(&path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&path)
                .to_string();
            descriptors.push(OperationDescriptor {
                kind: OperationKind::Delete,
                source: self.endpoint_for_path(path.clone()),
                title: format!("Delete {name}"),
                ..OperationDescriptor::default()
            });
            payloads.push(QueuedExplorerOperation::Delete(DeleteItemsRequest {
                paths: vec![path],
                permanent: true,
            }));
        }

        self.enqueue_operations_with_ids(label, false, descriptors, payloads)
            .await
    }

    pub async fn snapshot(&self) -> OperationQueueSnapshot {
        self.snapshot_with_redo_state().await
    }

    pub async fn cancel(&self, operation_id: u64) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.cancel(operation_id).await {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} cannot be canceled."
            )));
        }
        if let Some(token) = self.cancellations.lock().await.remove(&operation_id) {
            token.store(true, Ordering::SeqCst);
        }
        self.prune_non_retryable_payloads().await;
        self.schedule_pump();
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn cancel_batch(&self, batch_id: u64) -> ApiResult<OperationQueueSnapshot> {
        let canceled = self.queue.cancel_batch(batch_id).await;
        if canceled.is_empty() {
            return Err(ApiError::Message(format!(
                "Batch {batch_id} has no cancelable operations."
            )));
        }
        let mut cancellations = self.cancellations.lock().await;
        for operation_id in canceled {
            if let Some(token) = cancellations.remove(&operation_id) {
                token.store(true, Ordering::SeqCst);
            }
        }
        drop(cancellations);
        self.prune_non_retryable_payloads().await;
        self.schedule_pump();
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn retry(&self, operation_id: u64) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.retry(operation_id).await {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} cannot be retried."
            )));
        }
        self.schedule_pump();
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn pause(&self, operation_id: u64) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.pause_operation(operation_id).await {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} cannot be paused."
            )));
        }
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn resume(&self, operation_id: u64) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.resume_operation(operation_id).await {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} cannot be resumed."
            )));
        }
        self.schedule_pump();
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn pause_batch(&self, batch_id: u64) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.pause_batch(batch_id).await {
            return Err(ApiError::Message(format!(
                "Batch {batch_id} cannot be paused."
            )));
        }
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn resume_batch(&self, batch_id: u64) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.resume_batch(batch_id).await {
            return Err(ApiError::Message(format!(
                "Batch {batch_id} cannot be resumed."
            )));
        }
        self.schedule_pump();
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn pause_all(&self) -> OperationQueueSnapshot {
        self.queue.pause_all().await;
        self.snapshot_with_redo_state().await
    }

    pub async fn resume_all(&self) -> OperationQueueSnapshot {
        self.queue.resume_all().await;
        self.schedule_pump();
        self.snapshot_with_redo_state().await
    }

    pub async fn set_priority(
        &self,
        operation_id: u64,
        priority: OperationPriority,
    ) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.set_priority(operation_id, priority).await {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} priority could not be updated."
            )));
        }
        self.schedule_pump();
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn set_bandwidth_limit(&self, limit: String) -> OperationQueueSnapshot {
        self.queue.set_bandwidth_limit(limit).await;
        self.snapshot_with_redo_state().await
    }

    pub async fn set_transfer_profile(
        &self,
        profile_id: String,
        profile_name: String,
        max_concurrent: usize,
        bandwidth_limit: String,
    ) -> OperationQueueSnapshot {
        self.queue
            .set_transfer_profile(profile_id, profile_name, max_concurrent, bandwidth_limit)
            .await;
        self.schedule_pump();
        self.snapshot_with_redo_state().await
    }

    pub async fn undo(&self, undo_token_id: u64) -> ApiResult<OperationQueueSnapshot> {
        let row = self.transfers.transfer_by_undo_token(undo_token_id).await?;
        if row.status != FileTransferStatus::Completed || !row.undoable {
            return Err(ApiError::Message(format!(
                "Transfer {} cannot be undone.",
                row.id
            )));
        }

        let snapshot = match row.transfer_type {
            FileTransferType::Rename => self.enqueue_undo_rename(&row).await?,
            FileTransferType::Move => self.enqueue_undo_move(&row).await?,
            _ => {
                return Err(ApiError::Message(format!(
                    "Transfer {} does not support undo.",
                    row.id
                )));
            }
        };
        self.transfers.clear_undo(row.id).await?;
        self.redo_stack.lock().await.push(row);
        let mut snapshot = snapshot;
        snapshot.redo_available = true;
        Ok(snapshot)
    }

    pub async fn redo(&self) -> ApiResult<OperationQueueSnapshot> {
        let row = self.redo_stack.lock().await.pop().ok_or_else(|| {
            ApiError::Message("No undone rename or move is available to redo.".to_string())
        })?;
        match self.enqueue_original_transfer(&row).await {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => {
                self.redo_stack.lock().await.push(row);
                Err(error)
            }
        }
    }

    pub async fn resolve_conflict(
        &self,
        operation_id: u64,
        policy: ConflictPolicy,
        apply_to_batch: bool,
    ) -> ApiResult<OperationQueueSnapshot> {
        if !self
            .queue
            .resolve_conflict(operation_id, policy, apply_to_batch)
            .await
        {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} conflict could not be resolved."
            )));
        }
        self.prune_non_retryable_payloads().await;
        self.schedule_pump();
        Ok(self.snapshot_with_redo_state().await)
    }

    pub async fn clear_terminal(&self) -> OperationQueueSnapshot {
        self.queue.clear_terminal().await;
        self.prune_missing_payloads().await;
        self.snapshot_with_redo_state().await
    }

    async fn snapshot_with_redo_state(&self) -> OperationQueueSnapshot {
        let mut snapshot = self.queue.snapshot().await;
        snapshot.redo_available = !self.redo_stack.lock().await.is_empty();
        snapshot
    }

    async fn enqueue_undo_rename(
        &self,
        row: &crate::core::file_transfer::FileTransferRecord,
    ) -> ApiResult<OperationQueueSnapshot> {
        if row.item_type == FileTransferItemType::Remote {
            if row.remote_source_name.is_empty()
                || row.remote_source_path.is_empty()
                || row.remote_dest_name.is_empty()
                || row.remote_dest_path.is_empty()
            {
                return Err(ApiError::Message(
                    "Remote rename undo is missing source or destination metadata.".to_string(),
                ));
            }
            let current_path = self
                .explorer
                .remote_virtual_path(&row.remote_dest_name, &row.remote_dest_path)
                .await?;
            let original_name = file_name_for_path(&row.remote_source_path)?;
            let source_is_directory = self
                .explorer
                .item_is_directory(&current_path)
                .await?
                .unwrap_or(false);
            return self
                .enqueue_rename_item_inner(RenameItemRequest {
                    path: current_path,
                    new_name: original_name,
                    source_is_directory: Some(source_is_directory),
                })
                .await;
        }

        if row.local_source_path.is_empty() || row.local_dest_path.is_empty() {
            return Err(ApiError::Message(
                "Local rename undo is missing source or destination metadata.".to_string(),
            ));
        }
        let original_name = file_name_for_path(&row.local_source_path)?;
        let source_is_directory = self
            .explorer
            .item_is_directory(&row.local_dest_path)
            .await?
            .unwrap_or(false);
        self.enqueue_rename_item_inner(RenameItemRequest {
            path: row.local_dest_path.clone(),
            new_name: original_name,
            source_is_directory: Some(source_is_directory),
        })
        .await
    }

    async fn enqueue_undo_move(
        &self,
        row: &crate::core::file_transfer::FileTransferRecord,
    ) -> ApiResult<OperationQueueSnapshot> {
        if row.item_type == FileTransferItemType::Remote {
            if row.remote_source_name.is_empty()
                || row.remote_source_path.is_empty()
                || row.remote_dest_name.is_empty()
                || row.remote_dest_path.is_empty()
            {
                return Err(ApiError::Message(
                    "Remote move undo is missing source or destination metadata.".to_string(),
                ));
            }
            let current_path = self
                .explorer
                .remote_virtual_path(&row.remote_dest_name, &row.remote_dest_path)
                .await?;
            let original_parent_path = remote_parent_for_path(&row.remote_source_path)?;
            let original_parent = self
                .explorer
                .remote_virtual_path(&row.remote_source_name, &original_parent_path)
                .await?;
            let original_name = file_name_for_path(&row.remote_source_path)?;
            let is_directory = self
                .explorer
                .item_is_directory(&current_path)
                .await?
                .unwrap_or(false);
            return self
                .enqueue_paste_items_inner(PasteItemsRequest {
                    sources: vec![PasteItem {
                        path: current_path,
                        is_directory,
                    }],
                    destination_directory: original_parent,
                    operation: ClipboardOperation::Move,
                    target_name: Some(original_name),
                })
                .await;
        }

        if row.local_source_path.is_empty() || row.local_dest_path.is_empty() {
            return Err(ApiError::Message(
                "Local move undo is missing source or destination metadata.".to_string(),
            ));
        }
        let original_name = file_name_for_path(&row.local_source_path)?;
        let original_parent = Path::new(&row.local_source_path)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .to_string_lossy()
            .to_string();
        let is_directory = self
            .explorer
            .item_is_directory(&row.local_dest_path)
            .await?
            .unwrap_or(false);
        self.enqueue_paste_items_inner(PasteItemsRequest {
            sources: vec![PasteItem {
                path: row.local_dest_path.clone(),
                is_directory,
            }],
            destination_directory: original_parent,
            operation: ClipboardOperation::Move,
            target_name: Some(original_name),
        })
        .await
    }

    async fn enqueue_original_transfer(
        &self,
        row: &FileTransferRecord,
    ) -> ApiResult<OperationQueueSnapshot> {
        match row.transfer_type {
            FileTransferType::Rename => self.enqueue_redo_rename(row).await,
            FileTransferType::Move => self.enqueue_redo_move(row).await,
            _ => Err(ApiError::Message(format!(
                "Transfer {} does not support redo.",
                row.id
            ))),
        }
    }

    async fn enqueue_redo_rename(
        &self,
        row: &FileTransferRecord,
    ) -> ApiResult<OperationQueueSnapshot> {
        if row.item_type == FileTransferItemType::Remote {
            if row.remote_source_name.is_empty()
                || row.remote_source_path.is_empty()
                || row.remote_dest_path.is_empty()
            {
                return Err(ApiError::Message(
                    "Remote rename redo is missing source or destination metadata.".to_string(),
                ));
            }
            let current_path = self
                .explorer
                .remote_virtual_path(&row.remote_source_name, &row.remote_source_path)
                .await?;
            let redone_name = file_name_for_path(&row.remote_dest_path)?;
            let source_is_directory = self
                .explorer
                .item_is_directory(&current_path)
                .await?
                .unwrap_or(false);
            return self
                .enqueue_rename_item_inner(RenameItemRequest {
                    path: current_path,
                    new_name: redone_name,
                    source_is_directory: Some(source_is_directory),
                })
                .await;
        }

        if row.local_source_path.is_empty() || row.local_dest_path.is_empty() {
            return Err(ApiError::Message(
                "Local rename redo is missing source or destination metadata.".to_string(),
            ));
        }
        let redone_name = file_name_for_path(&row.local_dest_path)?;
        let source_is_directory = self
            .explorer
            .item_is_directory(&row.local_source_path)
            .await?
            .unwrap_or(false);
        self.enqueue_rename_item_inner(RenameItemRequest {
            path: row.local_source_path.clone(),
            new_name: redone_name,
            source_is_directory: Some(source_is_directory),
        })
        .await
    }

    async fn enqueue_redo_move(
        &self,
        row: &FileTransferRecord,
    ) -> ApiResult<OperationQueueSnapshot> {
        if row.item_type == FileTransferItemType::Remote {
            if row.remote_source_name.is_empty()
                || row.remote_source_path.is_empty()
                || row.remote_dest_name.is_empty()
                || row.remote_dest_path.is_empty()
            {
                return Err(ApiError::Message(
                    "Remote move redo is missing source or destination metadata.".to_string(),
                ));
            }
            let current_path = self
                .explorer
                .remote_virtual_path(&row.remote_source_name, &row.remote_source_path)
                .await?;
            let redone_parent_path = remote_parent_for_path(&row.remote_dest_path)?;
            let redone_parent = self
                .explorer
                .remote_virtual_path(&row.remote_dest_name, &redone_parent_path)
                .await?;
            let redone_name = file_name_for_path(&row.remote_dest_path)?;
            let is_directory = self
                .explorer
                .item_is_directory(&current_path)
                .await?
                .unwrap_or(false);
            return self
                .enqueue_paste_items_inner(PasteItemsRequest {
                    sources: vec![PasteItem {
                        path: current_path,
                        is_directory,
                    }],
                    destination_directory: redone_parent,
                    operation: ClipboardOperation::Move,
                    target_name: Some(redone_name),
                })
                .await;
        }

        if row.local_source_path.is_empty() || row.local_dest_path.is_empty() {
            return Err(ApiError::Message(
                "Local move redo is missing source or destination metadata.".to_string(),
            ));
        }
        let redone_name = file_name_for_path(&row.local_dest_path)?;
        let redone_parent = Path::new(&row.local_dest_path)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .to_string_lossy()
            .to_string();
        let is_directory = self
            .explorer
            .item_is_directory(&row.local_source_path)
            .await?
            .unwrap_or(false);
        self.enqueue_paste_items_inner(PasteItemsRequest {
            sources: vec![PasteItem {
                path: row.local_source_path.clone(),
                is_directory,
            }],
            destination_directory: redone_parent,
            operation: ClipboardOperation::Move,
            target_name: Some(redone_name),
        })
        .await
    }

    async fn clear_redo_stack(&self) {
        self.redo_stack.lock().await.clear();
    }

    fn schedule_pump(&self) {
        if self.pumping.swap(true, Ordering::SeqCst) {
            return;
        }
        let service = self.clone();
        tokio::spawn(async move {
            loop {
                let ready = service.queue.take_ready().await;
                if ready.is_empty() {
                    service.pumping.store(false, Ordering::SeqCst);
                    break;
                }
                for operation in ready {
                    let worker = service.clone();
                    tokio::spawn(async move {
                        let operation_id = operation.operation_id;
                        let cancellation = Arc::new(AtomicBool::new(false));
                        worker
                            .cancellations
                            .lock()
                            .await
                            .insert(operation_id, cancellation.clone());
                        let result = worker.execute(operation, cancellation.clone()).await;
                        worker
                            .finish_execution_result(operation_id, result, cancellation.as_ref())
                            .await;
                        if !matches!(
                            worker
                                .queue
                                .snapshot()
                                .await
                                .operations
                                .iter()
                                .find(|operation| operation.operation_id == operation_id)
                                .map(|operation| operation.status),
                            Some(OperationStatus::WaitingForResolution)
                        ) {
                            worker.cancellations.lock().await.remove(&operation_id);
                        }
                        worker.schedule_pump();
                    });
                }
            }
        });
    }

    async fn finish_execution_result(
        &self,
        operation_id: u64,
        result: ApiResult<ExecutionOutcome>,
        cancellation: &AtomicBool,
    ) {
        let transfer_id = self
            .queue
            .snapshot()
            .await
            .operations
            .iter()
            .find(|operation| operation.operation_id == operation_id)
            .map(|operation| operation.transfer_id)
            .unwrap_or_default();
        match result {
            Ok(ExecutionOutcome::Completed) => {
                self.queue.complete(operation_id, None).await;
                if transfer_id > 0 {
                    let _ = self.transfers.complete_transfer(transfer_id).await;
                }
                self.payloads.lock().await.remove(&operation_id);
            }
            Ok(ExecutionOutcome::Skipped) => {
                self.queue.skip(operation_id).await;
                if transfer_id > 0 {
                    let _ = self.transfers.skip_transfer(transfer_id).await;
                }
                self.payloads.lock().await.remove(&operation_id);
            }
            Ok(ExecutionOutcome::WaitingForConflict) => {}
            Err(error)
                if cancellation.load(Ordering::SeqCst) || is_operation_canceled_error(&error) =>
            {
                self.queue.cancel(operation_id).await;
                if transfer_id > 0 {
                    let _ = self
                        .transfers
                        .cancel_transfer(transfer_id, "Operation canceled.".to_string())
                        .await;
                }
                self.payloads.lock().await.remove(&operation_id);
            }
            Err(error) => {
                let message = error.to_string();
                self.queue
                    .complete(operation_id, Some(message.clone()))
                    .await;
                if transfer_id > 0 {
                    let _ = self.transfers.fail_transfer(transfer_id, message).await;
                }
            }
        }
    }

    async fn execute(
        &self,
        operation: OperationDescriptor,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExecutionOutcome> {
        let payload = self
            .payloads
            .lock()
            .await
            .get(&operation.operation_id)
            .cloned()
            .ok_or_else(|| {
                ApiError::Message(format!(
                    "Operation {} has no executable payload.",
                    operation.operation_id
                ))
            })?;
        ensure_not_canceled(&cancellation)?;
        if operation.transfer_id > 0 {
            let _ = self.transfers.mark_started(operation.transfer_id).await;
        }
        match payload {
            QueuedExplorerOperation::Create(request) => {
                if let Some(outcome) = self
                    .resolve_target_conflict(
                        operation.operation_id,
                        &create_destination(&request),
                        operation.conflict_policy,
                        cancellation.clone(),
                    )
                    .await?
                {
                    return Ok(outcome);
                }
                self.explorer
                    .create_item_with_cancellation_transfer(
                        request,
                        cancellation.clone(),
                        operation.transfer_id,
                    )
                    .await?;
            }
            QueuedExplorerOperation::Rename(request) => {
                let destination = rename_destination(&request);
                if request.path != destination.to_string_lossy() {
                    if let Some(outcome) = self
                        .resolve_target_conflict(
                            operation.operation_id,
                            &destination,
                            operation.conflict_policy,
                            cancellation.clone(),
                        )
                        .await?
                    {
                        return Ok(outcome);
                    }
                }
                self.explorer
                    .rename_item_with_cancellation_transfer(
                        request,
                        cancellation.clone(),
                        operation.transfer_id,
                    )
                    .await?;
            }
            QueuedExplorerOperation::Delete(request) => {
                self.explorer
                    .delete_items_with_cancellation(request, cancellation.clone())
                    .await?;
            }
            QueuedExplorerOperation::Paste(mut request) => {
                ensure_not_canceled(&cancellation)?;
                if let Some(destination) = paste_destination(&request) {
                    let destination_path = destination.to_string_lossy().to_string();
                    if let Some(destination_is_directory) =
                        self.explorer.item_is_directory(&destination_path).await?
                    {
                        ensure_not_canceled(&cancellation)?;
                        match operation.conflict_policy {
                            ConflictPolicy::Ask => {
                                if !self.queue.wait_for_conflict(operation.operation_id).await {
                                    return Err(ApiError::Message(format!(
                                        "Operation {} could not wait for conflict resolution.",
                                        operation.operation_id
                                    )));
                                }
                                return Ok(ExecutionOutcome::WaitingForConflict);
                            }
                            ConflictPolicy::Replace => {
                                ensure_not_canceled(&cancellation)?;
                                if source_matches_destination(&request, &destination).await? {
                                    return Err(ApiError::Message(
                                        "Cannot replace an item with itself.".to_string(),
                                    ));
                                }
                                let source_is_directory = request
                                    .sources
                                    .first()
                                    .is_some_and(|source| source.is_directory);
                                if source_is_directory != destination_is_directory {
                                    return Err(ApiError::Message(format!(
                                        "{} is a {}; cannot replace it with a {}.",
                                        destination.display(),
                                        if destination_is_directory {
                                            "folder"
                                        } else {
                                            "file"
                                        },
                                        if source_is_directory {
                                            "folder"
                                        } else {
                                            "file"
                                        }
                                    )));
                                }
                                self.explorer
                                    .delete_items_with_cancellation(
                                        DeleteItemsRequest {
                                            paths: vec![destination_path],
                                            permanent: true,
                                        },
                                        cancellation.clone(),
                                    )
                                    .await?;
                            }
                            ConflictPolicy::Skip => {
                                return Ok(ExecutionOutcome::Skipped);
                            }
                            ConflictPolicy::KeepBoth => {
                                ensure_not_canceled(&cancellation)?;
                                let keep_both_destination = self
                                    .available_keep_both_destination(
                                        &destination,
                                        Some(cancellation.as_ref()),
                                    )
                                    .await?;
                                let target_name = keep_both_destination
                                    .file_name()
                                    .and_then(|value| value.to_str())
                                    .ok_or_else(|| {
                                        ApiError::Message(format!(
                                            "Could not create a unique name for {}.",
                                            destination.display()
                                        ))
                                    })?;
                                request.target_name = Some(target_name.to_string());
                            }
                        }
                    }
                }
                ensure_not_canceled(&cancellation)?;
                self.explorer
                    .paste_items_with_cancellation(request, cancellation.clone())
                    .await?;
            }
            QueuedExplorerOperation::ArchiveCreate(mut request) => {
                let destination = PathBuf::from(&request.destination_path);
                if self
                    .explorer
                    .item_is_directory(&destination.to_string_lossy())
                    .await?
                    .is_some()
                {
                    match operation.conflict_policy {
                        ConflictPolicy::Ask => {
                            if !self.queue.wait_for_conflict(operation.operation_id).await {
                                return Err(ApiError::Message(format!(
                                    "Operation {} could not wait for conflict resolution.",
                                    operation.operation_id
                                )));
                            }
                            return Ok(ExecutionOutcome::WaitingForConflict);
                        }
                        ConflictPolicy::Replace => {
                            self.explorer
                                .delete_items_with_cancellation(
                                    DeleteItemsRequest {
                                        paths: vec![destination.to_string_lossy().to_string()],
                                        permanent: true,
                                    },
                                    cancellation.clone(),
                                )
                                .await?;
                        }
                        ConflictPolicy::Skip => return Ok(ExecutionOutcome::Skipped),
                        ConflictPolicy::KeepBoth => {
                            let keep_both_destination = self
                                .available_keep_both_destination(
                                    &destination,
                                    Some(cancellation.as_ref()),
                                )
                                .await?;
                            request.destination_path = keep_both_destination.display().to_string();
                        }
                    }
                }
                ensure_not_canceled(&cancellation)?;
                tokio::task::spawn_blocking(move || archive_create_blocking(request))
                    .await
                    .map_err(|err| ApiError::Message(format!("Archive worker failed: {err}")))??;
            }
        }
        ensure_not_canceled(&cancellation)?;
        Ok(ExecutionOutcome::Completed)
    }

    async fn resolve_target_conflict(
        &self,
        operation_id: u64,
        destination: &Path,
        policy: ConflictPolicy,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<Option<ExecutionOutcome>> {
        ensure_not_canceled(&cancellation)?;
        let destination_path = destination.to_string_lossy().to_string();
        if self
            .explorer
            .item_is_directory(&destination_path)
            .await?
            .is_none()
        {
            return Ok(None);
        }

        match policy {
            ConflictPolicy::Ask => {
                if !self.queue.wait_for_conflict(operation_id).await {
                    return Err(ApiError::Message(format!(
                        "Operation {operation_id} could not wait for conflict resolution."
                    )));
                }
                Ok(Some(ExecutionOutcome::WaitingForConflict))
            }
            ConflictPolicy::Replace => {
                self.explorer
                    .delete_items_with_cancellation(
                        DeleteItemsRequest {
                            paths: vec![destination_path],
                            permanent: true,
                        },
                        cancellation,
                    )
                    .await?;
                Ok(None)
            }
            ConflictPolicy::Skip => Ok(Some(ExecutionOutcome::Skipped)),
            ConflictPolicy::KeepBoth => Err(ApiError::Message(
                "Keep Both is not available for create or rename operations.".to_string(),
            )),
        }
    }

    async fn available_keep_both_destination(
        &self,
        path: &Path,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<PathBuf> {
        ensure_not_canceled_if(cancellation)?;
        if self
            .explorer
            .item_is_directory(&path.to_string_lossy())
            .await?
            .is_none()
        {
            return Ok(path.to_path_buf());
        }
        for index in 1..10_000 {
            ensure_not_canceled_if(cancellation)?;
            let candidate = keep_both_candidate(path, index)?;
            if self
                .explorer
                .item_is_directory(&candidate.to_string_lossy())
                .await?
                .is_none()
            {
                return Ok(candidate);
            }
        }
        Err(ApiError::Message(format!(
            "Could not create a unique name for {}.",
            path.display()
        )))
    }

    async fn prune_non_retryable_payloads(&self) {
        let snapshot = self.queue.snapshot().await;
        let executable_ids: std::collections::HashSet<u64> = snapshot
            .operations
            .iter()
            .filter(|operation| {
                matches!(
                    operation.status,
                    OperationStatus::Queued
                        | OperationStatus::InProgress
                        | OperationStatus::WaitingForResolution
                        | OperationStatus::Failed
                )
            })
            .map(|operation| operation.operation_id)
            .collect();
        self.payloads
            .lock()
            .await
            .retain(|operation_id, _| executable_ids.contains(operation_id));
    }

    async fn prune_missing_payloads(&self) {
        let snapshot = self.queue.snapshot().await;
        let existing_ids: std::collections::HashSet<u64> = snapshot
            .operations
            .iter()
            .map(|operation| operation.operation_id)
            .collect();
        self.payloads
            .lock()
            .await
            .retain(|operation_id, _| existing_ids.contains(operation_id));
    }
}

fn ensure_not_canceled(cancellation: &AtomicBool) -> ApiResult<()> {
    if cancellation.load(Ordering::SeqCst) {
        return Err(ApiError::Message("Operation canceled.".to_string()));
    }
    Ok(())
}

fn ensure_not_canceled_if(cancellation: Option<&AtomicBool>) -> ApiResult<()> {
    if let Some(cancellation) = cancellation {
        ensure_not_canceled(cancellation)?;
    }
    Ok(())
}

fn is_operation_canceled_error(error: &ApiError) -> bool {
    error
        .to_string()
        .eq_ignore_ascii_case("Operation canceled.")
}

fn local_endpoint(path: String) -> OperationEndpoint {
    OperationEndpoint {
        local_path: path,
        ..OperationEndpoint::default()
    }
}

fn endpoint_for_path(path: String, remote: Option<RemoteBrowseTarget>) -> OperationEndpoint {
    if let Some(remote) = remote {
        OperationEndpoint {
            remote_name: remote.remote_name,
            remote_path: remote.remote_path,
            ..OperationEndpoint::default()
        }
    } else {
        local_endpoint(path)
    }
}

fn transfer_record_for_operation(operation: &OperationDescriptor) -> FileTransferRecord {
    let transfer_type = match operation.kind {
        OperationKind::Copy => FileTransferType::Copy,
        OperationKind::Move => FileTransferType::Move,
        OperationKind::Create => FileTransferType::Create,
        OperationKind::Rename => FileTransferType::Rename,
        OperationKind::Delete => FileTransferType::Delete,
        OperationKind::Upload => FileTransferType::Upload,
        OperationKind::Download => FileTransferType::Download,
        OperationKind::Archive => FileTransferType::Archive,
    };
    let item_type = if operation.source.is_remote() || operation.target.is_remote() {
        FileTransferItemType::Remote
    } else {
        FileTransferItemType::Local
    };
    let mut record =
        FileTransferRecord::new(transfer_type, item_type, operation_file_name(operation));
    record.status = FileTransferStatus::Queued;
    record.conflict_policy = match operation.conflict_policy {
        ConflictPolicy::Ask => FileTransferConflictPolicy::Ask,
        ConflictPolicy::Replace => FileTransferConflictPolicy::Replace,
        ConflictPolicy::Skip => FileTransferConflictPolicy::Skip,
        ConflictPolicy::KeepBoth => FileTransferConflictPolicy::KeepBoth,
    };
    record.local_source_path = operation.source.local_path.clone();
    record.local_dest_path = operation.target.local_path.clone();
    record.remote_source_name = operation.source.remote_name.clone();
    record.remote_source_path = operation.source.remote_path.clone();
    record.remote_dest_name = operation.target.remote_name.clone();
    record.remote_dest_path = operation.target.remote_path.clone();
    record.cancelable = true;
    record.retryable = true;
    record
}

fn operation_file_name(operation: &OperationDescriptor) -> String {
    let target = if operation.target.is_remote() {
        operation.target.remote_path.as_str()
    } else {
        operation.target.local_path.as_str()
    };
    let source = if operation.source.is_remote() {
        operation.source.remote_path.as_str()
    } else {
        operation.source.local_path.as_str()
    };
    let path = if !target.is_empty() { target } else { source };
    file_name_for_path(path).unwrap_or_else(|_| {
        if operation.title.trim().is_empty() {
            operation_action_label(operation.kind).to_string()
        } else {
            operation.title.clone()
        }
    })
}

fn operation_kind_for_paste(
    operation: ClipboardOperation,
    source: &OperationEndpoint,
    target: &OperationEndpoint,
) -> OperationKind {
    match operation {
        ClipboardOperation::Move => OperationKind::Move,
        ClipboardOperation::Copy if source.is_remote() && !target.is_remote() => {
            OperationKind::Download
        }
        ClipboardOperation::Copy if !source.is_remote() && target.is_remote() => {
            OperationKind::Upload
        }
        ClipboardOperation::Copy => OperationKind::Copy,
    }
}

fn operation_action_label(kind: OperationKind) -> &'static str {
    match kind {
        OperationKind::Upload => "Upload",
        OperationKind::Download => "Download",
        OperationKind::Move => "Move",
        OperationKind::Create => "Create",
        OperationKind::Rename => "Rename",
        OperationKind::Delete => "Delete",
        OperationKind::Copy => "Copy",
        OperationKind::Archive => "Archive",
    }
}

fn file_name_for_path(path: &str) -> ApiResult<String> {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or_else(|| ApiError::Message(format!("Could not determine file name for {path}.")))
}

fn remote_parent_for_path(path: &str) -> ApiResult<String> {
    let parent = Path::new(path)
        .parent()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ApiError::Message(format!("Could not determine parent for {path}.")))?;
    if parent.is_empty() {
        Ok("/".to_string())
    } else {
        Ok(parent.to_string())
    }
}

fn paste_destination(request: &PasteItemsRequest) -> Option<PathBuf> {
    let source = request.sources.first()?;
    if request.sources.len() != 1 {
        return None;
    }
    let target_name = request.target_name.as_deref();
    let file_name = target_name
        .map(std::ffi::OsStr::new)
        .or_else(|| Path::new(&source.path).file_name())?;
    Some(Path::new(&request.destination_directory).join(file_name))
}

fn create_destination(request: &CreateItemRequest) -> PathBuf {
    Path::new(&request.directory).join(&request.name)
}

fn rename_destination(request: &RenameItemRequest) -> PathBuf {
    Path::new(&request.path)
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .join(&request.new_name)
}

fn keep_both_candidate(path: &Path, index: usize) -> ApiResult<PathBuf> {
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| ApiError::Message(format!("Cannot rename {}.", path.display())))?;
    let (stem, extension) = split_file_name(file_name);
    let suffix = if index == 1 {
        " copy".to_string()
    } else {
        format!(" copy {index}")
    };
    Ok(parent.join(match extension {
        Some(extension) => format!("{stem}{suffix}.{extension}"),
        None => format!("{stem}{suffix}"),
    }))
}

fn split_file_name(file_name: &str) -> (&str, Option<&str>) {
    if file_name == "." || file_name == ".." {
        return (file_name, None);
    }
    match file_name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            (stem, Some(extension))
        }
        _ => (file_name, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::{
        environment::AppEnvironmentService, explorer_library::ExplorerLibraryService,
        providers::ProviderService, proxy::ProxyService,
    };

    #[test]
    fn split_file_name_keeps_regular_extensions() {
        assert_eq!(split_file_name("report.txt"), ("report", Some("txt")));
        assert_eq!(
            split_file_name("archive.tar.gz"),
            ("archive.tar", Some("gz"))
        );
        assert_eq!(split_file_name(".env"), (".env", None));
        assert_eq!(split_file_name("folder"), ("folder", None));
    }

    #[test]
    fn keep_both_candidate_uses_copy_suffixes() {
        let original = Path::new("/tmp/report.txt");
        assert_eq!(
            keep_both_candidate(original, 1)
                .unwrap()
                .file_name()
                .unwrap(),
            "report copy.txt"
        );
        assert_eq!(
            keep_both_candidate(original, 2)
                .unwrap()
                .file_name()
                .unwrap(),
            "report copy 2.txt"
        );
    }

    #[tokio::test]
    async fn keep_both_destination_stops_when_canceled() {
        let service = test_operation_queue_service();
        let cancellation = AtomicBool::new(true);

        let result = service
            .available_keep_both_destination(Path::new("/tmp/report.txt"), Some(&cancellation))
            .await;

        assert!(result.as_ref().is_err_and(is_operation_canceled_error));
    }

    #[test]
    fn paste_destination_uses_explicit_target_name() {
        let destination = paste_destination(&PasteItemsRequest {
            sources: vec![PasteItem {
                path: "/tmp/current-name.txt".to_string(),
                is_directory: false,
            }],
            destination_directory: "/tmp/original-parent".to_string(),
            operation: ClipboardOperation::Move,
            target_name: Some("original-name.txt".to_string()),
        })
        .expect("destination");

        assert_eq!(
            destination,
            Path::new("/tmp/original-parent").join("original-name.txt")
        );
    }

    #[test]
    fn create_and_rename_destinations_match_payload_targets() {
        assert_eq!(
            create_destination(&CreateItemRequest {
                directory: "/tmp/work".to_string(),
                name: "report.md".to_string(),
                kind: CreateItemKind::File,
            }),
            Path::new("/tmp/work").join("report.md"),
        );

        assert_eq!(
            rename_destination(&RenameItemRequest {
                path: "/tmp/work/current.md".to_string(),
                new_name: "renamed.md".to_string(),
                source_is_directory: Some(false),
            }),
            Path::new("/tmp/work").join("renamed.md"),
        );
    }

    #[test]
    fn endpoint_for_path_preserves_remote_metadata() {
        let endpoint = endpoint_for_path(
            "/Users/misty/.misty/mnt/drive-work/report.pdf".to_string(),
            Some(RemoteBrowseTarget {
                provider_type: "drive".to_string(),
                remote_name: "drive-work".to_string(),
                remote_path: "/report.pdf".to_string(),
            }),
        );

        assert!(endpoint.local_path.is_empty());
        assert_eq!(endpoint.remote_name, "drive-work");
        assert_eq!(endpoint.remote_path, "/report.pdf");
    }

    #[test]
    fn endpoint_for_path_keeps_local_paths_local() {
        let endpoint = endpoint_for_path("/tmp/report.pdf".to_string(), None);

        assert_eq!(endpoint.local_path, "/tmp/report.pdf");
        assert!(endpoint.remote_name.is_empty());
        assert!(endpoint.remote_path.is_empty());
    }

    #[test]
    fn remote_to_local_copy_is_described_as_download() {
        let source = endpoint_for_path(
            "/Users/misty/.misty/mnt/drive-work/work/report.pdf".to_string(),
            Some(RemoteBrowseTarget {
                provider_type: "drive".to_string(),
                remote_name: "drive-work".to_string(),
                remote_path: "/work/report.pdf".to_string(),
            }),
        );
        let target = local_endpoint("/Users/misty/Downloads/report.pdf".to_string());

        assert_eq!(
            operation_kind_for_paste(ClipboardOperation::Copy, &source, &target),
            OperationKind::Download
        );
        assert_eq!(operation_action_label(OperationKind::Download), "Download");
    }

    #[test]
    fn local_to_remote_copy_is_described_as_upload() {
        let source = local_endpoint("/Users/misty/Desktop/report.pdf".to_string());
        let target = endpoint_for_path(
            "/Users/misty/.misty/mnt/drive-work/uploads/report.pdf".to_string(),
            Some(RemoteBrowseTarget {
                provider_type: "drive".to_string(),
                remote_name: "drive-work".to_string(),
                remote_path: "/uploads/report.pdf".to_string(),
            }),
        );

        assert_eq!(
            operation_kind_for_paste(ClipboardOperation::Copy, &source, &target),
            OperationKind::Upload
        );
        assert_eq!(operation_action_label(OperationKind::Upload), "Upload");
    }

    #[test]
    fn local_copy_and_remote_move_keep_their_operation_kinds() {
        let local_source = local_endpoint("/tmp/report.pdf".to_string());
        let local_target = local_endpoint("/tmp/archive/report.pdf".to_string());
        let remote_source = endpoint_for_path(
            "/Users/misty/.misty/mnt/drive-work/report.pdf".to_string(),
            Some(RemoteBrowseTarget {
                provider_type: "drive".to_string(),
                remote_name: "drive-work".to_string(),
                remote_path: "/report.pdf".to_string(),
            }),
        );

        assert_eq!(
            operation_kind_for_paste(ClipboardOperation::Copy, &local_source, &local_target),
            OperationKind::Copy
        );
        assert_eq!(
            operation_kind_for_paste(ClipboardOperation::Move, &remote_source, &local_target),
            OperationKind::Move
        );
    }

    #[test]
    fn remote_parent_for_path_keeps_root_parent() {
        assert_eq!(remote_parent_for_path("/photo.png").unwrap(), "/");
        assert_eq!(
            remote_parent_for_path("/source/photo.png").unwrap(),
            "/source"
        );
    }

    #[tokio::test]
    async fn canceling_queued_service_operation_prunes_payload_before_execution() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("queued-cancel");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let target = root.join("never-created.txt");
        let request = CreateItemRequest {
            directory: root.to_string_lossy().to_string(),
            name: "never-created.txt".to_string(),
            kind: CreateItemKind::File,
        };
        let (_, operation_ids) = service
            .queue
            .enqueue_batch_with_ids(
                "Create file",
                false,
                vec![OperationDescriptor {
                    kind: OperationKind::Create,
                    target: local_endpoint(target.to_string_lossy().to_string()),
                    title: "Create never-created.txt".to_string(),
                    ..OperationDescriptor::default()
                }],
            )
            .await;
        let operation_id = operation_ids[0];
        service
            .payloads
            .lock()
            .await
            .insert(operation_id, QueuedExplorerOperation::Create(request));

        let snapshot = service.cancel(operation_id).await.unwrap();

        let operation = snapshot
            .operations
            .iter()
            .find(|operation| operation.operation_id == operation_id)
            .unwrap();
        assert_eq!(operation.status, OperationStatus::Canceled);
        assert!(!service.payloads.lock().await.contains_key(&operation_id));
        assert!(!target.exists());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn retrying_failed_service_operation_reuses_payload_and_executes() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("retry-create");
        let missing_parent = root.join("created-after-failure");
        let target = missing_parent.join("retried.txt");

        let snapshot = service
            .enqueue_create_item(CreateItemRequest {
                directory: missing_parent.to_string_lossy().to_string(),
                name: "retried.txt".to_string(),
                kind: CreateItemKind::File,
            })
            .await
            .unwrap();
        let operation_id = snapshot.operations[0].operation_id;

        wait_for_operation_status(&service, operation_id, OperationStatus::Failed).await;
        assert!(service.payloads.lock().await.contains_key(&operation_id));
        assert!(!target.exists());

        tokio::fs::create_dir_all(&missing_parent).await.unwrap();
        service.retry(operation_id).await.unwrap();

        wait_for_operation_status(&service, operation_id, OperationStatus::Completed).await;
        assert!(!service.payloads.lock().await.contains_key(&operation_id));
        assert!(target.is_file());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn cancellation_error_finishes_service_operation_as_canceled_not_failed() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("finish-cancel");
        let target = root.join("never-created.txt");
        let request = CreateItemRequest {
            directory: root.to_string_lossy().to_string(),
            name: "never-created.txt".to_string(),
            kind: CreateItemKind::File,
        };
        let (_, operation_ids) = service
            .queue
            .enqueue_batch_with_ids(
                "Create file",
                false,
                vec![OperationDescriptor {
                    kind: OperationKind::Create,
                    target: local_endpoint(target.to_string_lossy().to_string()),
                    title: "Create never-created.txt".to_string(),
                    ..OperationDescriptor::default()
                }],
            )
            .await;
        let operation_id = operation_ids[0];
        service
            .payloads
            .lock()
            .await
            .insert(operation_id, QueuedExplorerOperation::Create(request));
        assert_eq!(
            service.queue.take_ready().await.remove(0).operation_id,
            operation_id
        );
        let cancellation = AtomicBool::new(false);

        service
            .finish_execution_result(
                operation_id,
                Err(ApiError::Message("Operation canceled.".to_string())),
                &cancellation,
            )
            .await;

        let snapshot = service.snapshot().await;
        let operation = snapshot
            .operations
            .iter()
            .find(|operation| operation.operation_id == operation_id)
            .unwrap();
        assert_eq!(operation.status, OperationStatus::Canceled);
        assert!(operation.error_message.is_empty());
        assert!(!service.payloads.lock().await.contains_key(&operation_id));

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn canceling_conflict_paused_operation_removes_payload_and_cancellation_token() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("cancel-conflict");
        let target = root.join("existing.txt");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&target, b"already here").await.unwrap();

        let snapshot = service
            .enqueue_create_item(CreateItemRequest {
                directory: root.to_string_lossy().to_string(),
                name: "existing.txt".to_string(),
                kind: CreateItemKind::File,
            })
            .await
            .unwrap();
        let operation_id = snapshot.operations[0].operation_id;

        wait_for_operation_status(
            &service,
            operation_id,
            OperationStatus::WaitingForResolution,
        )
        .await;
        assert!(service.payloads.lock().await.contains_key(&operation_id));
        assert!(service
            .cancellations
            .lock()
            .await
            .contains_key(&operation_id));

        let snapshot = service.cancel(operation_id).await.unwrap();

        let operation = snapshot
            .operations
            .iter()
            .find(|operation| operation.operation_id == operation_id)
            .unwrap();
        assert_eq!(operation.status, OperationStatus::Canceled);
        assert!(!service.payloads.lock().await.contains_key(&operation_id));
        assert!(!service
            .cancellations
            .lock()
            .await
            .contains_key(&operation_id));
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"already here");

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn resolving_conflict_with_skip_marks_service_operation_skipped() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("skip-conflict");
        let target = root.join("existing.txt");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&target, b"already here").await.unwrap();

        let snapshot = service
            .enqueue_create_item(CreateItemRequest {
                directory: root.to_string_lossy().to_string(),
                name: "existing.txt".to_string(),
                kind: CreateItemKind::File,
            })
            .await
            .unwrap();
        let operation_id = snapshot.operations[0].operation_id;

        wait_for_operation_status(
            &service,
            operation_id,
            OperationStatus::WaitingForResolution,
        )
        .await;

        service
            .resolve_conflict(operation_id, ConflictPolicy::Skip, false)
            .await
            .unwrap();

        wait_for_operation_status(&service, operation_id, OperationStatus::Skipped).await;
        assert!(!service.payloads.lock().await.contains_key(&operation_id));
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"already here");

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn inherited_skip_policy_marks_executed_service_operation_skipped() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("inherited-skip-conflict");
        let target = root.join("existing.txt");
        tokio::fs::create_dir_all(&root).await.unwrap();
        tokio::fs::write(&target, b"already here").await.unwrap();
        let request = CreateItemRequest {
            directory: root.to_string_lossy().to_string(),
            name: "existing.txt".to_string(),
            kind: CreateItemKind::File,
        };
        let (_, operation_ids) = service
            .queue
            .enqueue_batch_with_ids(
                "Create file",
                false,
                vec![OperationDescriptor {
                    kind: OperationKind::Create,
                    target: local_endpoint(target.to_string_lossy().to_string()),
                    conflict_policy: ConflictPolicy::Skip,
                    title: "Create existing.txt".to_string(),
                    ..OperationDescriptor::default()
                }],
            )
            .await;
        let operation_id = operation_ids[0];
        service
            .payloads
            .lock()
            .await
            .insert(operation_id, QueuedExplorerOperation::Create(request));

        service.schedule_pump();

        wait_for_operation_status(&service, operation_id, OperationStatus::Skipped).await;
        assert!(!service.payloads.lock().await.contains_key(&operation_id));
        assert_eq!(tokio::fs::read(&target).await.unwrap(), b"already here");

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn undo_then_redo_local_rename_uses_backend_redo_stack() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("redo-rename");
        tokio::fs::create_dir_all(&root).await.unwrap();
        let original = root.join("draft.txt");
        let renamed = root.join("final.txt");
        tokio::fs::write(&original, b"notes").await.unwrap();
        tokio::fs::rename(&original, &renamed).await.unwrap();

        let mut transfer = FileTransferRecord::new(
            FileTransferType::Rename,
            FileTransferItemType::Local,
            "final.txt".to_string(),
        );
        transfer.local_source_path = original.to_string_lossy().to_string();
        transfer.local_dest_path = renamed.to_string_lossy().to_string();
        let transfer_id = service.transfers.start_transfer(transfer).await.unwrap();
        service
            .transfers
            .complete_transfer(transfer_id)
            .await
            .unwrap();

        assert!(!original.exists());
        assert!(renamed.is_file());
        assert!(!service.snapshot().await.redo_available);

        let undo_snapshot = service.undo(transfer_id).await.unwrap();
        assert!(undo_snapshot.redo_available);
        let undo_operation_id = newest_operation_id(&undo_snapshot);
        wait_for_operation_status(&service, undo_operation_id, OperationStatus::Completed).await;
        assert!(original.is_file());
        assert!(!renamed.exists());

        let redo_snapshot = service.redo().await.unwrap();
        assert!(!redo_snapshot.redo_available);
        let redo_operation_id = newest_operation_id(&redo_snapshot);
        wait_for_operation_status(&service, redo_operation_id, OperationStatus::Completed).await;
        assert!(!original.exists());
        assert!(renamed.is_file());

        assert!(service.redo().await.is_err());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn undo_then_redo_local_move_uses_backend_redo_stack() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("redo-move");
        let source_dir = root.join("source");
        let dest_dir = root.join("dest");
        tokio::fs::create_dir_all(&source_dir).await.unwrap();
        tokio::fs::create_dir_all(&dest_dir).await.unwrap();
        let original = source_dir.join("draft.txt");
        let moved = dest_dir.join("draft.txt");
        tokio::fs::write(&original, b"notes").await.unwrap();
        tokio::fs::rename(&original, &moved).await.unwrap();

        let mut transfer = FileTransferRecord::new(
            FileTransferType::Move,
            FileTransferItemType::Local,
            "draft.txt".to_string(),
        );
        transfer.local_source_path = original.to_string_lossy().to_string();
        transfer.local_dest_path = moved.to_string_lossy().to_string();
        let transfer_id = service.transfers.start_transfer(transfer).await.unwrap();
        service
            .transfers
            .complete_transfer(transfer_id)
            .await
            .unwrap();

        assert!(!original.exists());
        assert!(moved.is_file());
        assert!(!service.snapshot().await.redo_available);

        let undo_snapshot = service.undo(transfer_id).await.unwrap();
        assert!(undo_snapshot.redo_available);
        let undo_operation_id = newest_operation_id(&undo_snapshot);
        wait_for_operation_status(&service, undo_operation_id, OperationStatus::Completed).await;
        assert!(original.is_file());
        assert!(!moved.exists());

        let redo_snapshot = service.redo().await.unwrap();
        assert!(!redo_snapshot.redo_available);
        let redo_operation_id = newest_operation_id(&redo_snapshot);
        wait_for_operation_status(&service, redo_operation_id, OperationStatus::Completed).await;
        assert!(!original.exists());
        assert!(moved.is_file());

        assert!(service.redo().await.is_err());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn file_sync_apply_invalidates_redo_stack_after_undo() {
        let service = test_operation_queue_service();
        let root = unique_test_dir("redo-file-sync-apply");
        let source_dir = root.join("source");
        let dest_dir = root.join("dest");
        let sync_source_dir = root.join("sync-source");
        let sync_dest_dir = root.join("sync-dest");
        tokio::fs::create_dir_all(&source_dir).await.unwrap();
        tokio::fs::create_dir_all(&dest_dir).await.unwrap();
        tokio::fs::create_dir_all(&sync_source_dir).await.unwrap();
        tokio::fs::create_dir_all(&sync_dest_dir).await.unwrap();

        let original = source_dir.join("draft.txt");
        let moved = dest_dir.join("draft.txt");
        tokio::fs::write(&original, b"notes").await.unwrap();
        tokio::fs::rename(&original, &moved).await.unwrap();

        let mut transfer = FileTransferRecord::new(
            FileTransferType::Move,
            FileTransferItemType::Local,
            "draft.txt".to_string(),
        );
        transfer.local_source_path = original.to_string_lossy().to_string();
        transfer.local_dest_path = moved.to_string_lossy().to_string();
        let transfer_id = service.transfers.start_transfer(transfer).await.unwrap();
        service
            .transfers
            .complete_transfer(transfer_id)
            .await
            .unwrap();

        let undo_snapshot = service.undo(transfer_id).await.unwrap();
        assert!(undo_snapshot.redo_available);
        let undo_operation_id = newest_operation_id(&undo_snapshot);
        wait_for_operation_status(&service, undo_operation_id, OperationStatus::Completed).await;

        let sync_source = sync_source_dir.join("sync.txt");
        tokio::fs::write(&sync_source, b"sync").await.unwrap();
        let (sync_snapshot, operation_ids) = service
            .enqueue_file_sync_apply(
                "Apply sync",
                vec![PasteItemsRequest {
                    sources: vec![PasteItem {
                        path: sync_source.to_string_lossy().to_string(),
                        is_directory: false,
                    }],
                    destination_directory: sync_dest_dir.to_string_lossy().to_string(),
                    operation: ClipboardOperation::Copy,
                    target_name: None,
                }],
                Vec::new(),
            )
            .await
            .unwrap();

        assert_eq!(operation_ids.len(), 1);
        assert!(!sync_snapshot.redo_available);
        assert!(service.redo().await.is_err());

        let _ = tokio::fs::remove_dir_all(&root).await;
    }

    #[tokio::test]
    async fn empty_operation_requests_do_not_invalidate_redo_stack() {
        let service = test_operation_queue_service();
        service
            .redo_stack
            .lock()
            .await
            .push(FileTransferRecord::new(
                FileTransferType::Rename,
                FileTransferItemType::Local,
                "draft.txt".to_string(),
            ));

        let paste_snapshot = service
            .enqueue_paste_items(PasteItemsRequest {
                sources: Vec::new(),
                destination_directory: "/tmp".to_string(),
                operation: ClipboardOperation::Copy,
                target_name: None,
            })
            .await
            .unwrap();
        assert!(paste_snapshot.redo_available);

        let rename_snapshot = service
            .enqueue_rename_items(RenameItemsRequest { items: Vec::new() })
            .await
            .unwrap();
        assert!(rename_snapshot.redo_available);

        let delete_snapshot = service
            .enqueue_delete_items(DeleteItemsRequest {
                paths: Vec::new(),
                permanent: true,
            })
            .await
            .unwrap();
        assert!(delete_snapshot.redo_available);
        assert_eq!(service.redo_stack.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn failed_enqueue_validation_does_not_invalidate_redo_stack() {
        let service = test_operation_queue_service();
        service
            .redo_stack
            .lock()
            .await
            .push(FileTransferRecord::new(
                FileTransferType::Rename,
                FileTransferItemType::Local,
                "draft.txt".to_string(),
            ));

        let result = service
            .enqueue_operations_with_ids(
                "Broken enqueue",
                false,
                vec![OperationDescriptor {
                    kind: OperationKind::Rename,
                    title: "Rename draft".to_string(),
                    ..OperationDescriptor::default()
                }],
                Vec::new(),
            )
            .await;

        assert!(result.is_err());
        assert!(service.snapshot().await.redo_available);
        assert_eq!(service.redo_stack.lock().await.len(), 1);
    }

    fn test_operation_queue_service() -> OperationQueueService {
        let environment = AppEnvironmentService::for_test_home(unique_test_dir("service-home"));
        let proxy = ProxyService::new(environment.clone());
        let providers = ProviderService::new(proxy.clone());
        let transfers = TransferService::new(environment.clone());
        let explorer_library = ExplorerLibraryService::new(environment.clone());
        let explorer = ExplorerService::new(
            environment,
            proxy,
            providers,
            transfers.clone(),
            explorer_library,
        );
        OperationQueueService::new(explorer, transfers)
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "misty-operation-queue-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    async fn wait_for_operation_status(
        service: &OperationQueueService,
        operation_id: u64,
        expected: OperationStatus,
    ) {
        for _ in 0..100 {
            let snapshot = service.snapshot().await;
            let status = snapshot
                .operations
                .iter()
                .find(|operation| operation.operation_id == operation_id)
                .map(|operation| operation.status);
            if status == Some(expected) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        panic!("operation {operation_id} did not reach {expected:?}");
    }

    fn newest_operation_id(snapshot: &OperationQueueSnapshot) -> u64 {
        snapshot
            .operations
            .iter()
            .map(|operation| operation.operation_id)
            .max()
            .expect("operation id")
    }
}

async fn source_matches_destination(
    request: &PasteItemsRequest,
    destination: &Path,
) -> ApiResult<bool> {
    let Some(source) = request.sources.first() else {
        return Ok(false);
    };
    let source_path = Path::new(&source.path);
    if source_path == destination {
        return Ok(true);
    }
    let Ok(source) = tokio::fs::canonicalize(source_path).await else {
        return Ok(false);
    };
    let Ok(destination) = tokio::fs::canonicalize(destination).await else {
        return Ok(false);
    };
    Ok(source == destination)
}
