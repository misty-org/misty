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
    file_transfer::{FileTransferItemType, FileTransferStatus, FileTransferType},
    operation_queue::{
        ConflictPolicy, OperationDescriptor, OperationEndpoint, OperationKind, OperationQueue,
        OperationQueueSnapshot, OperationStatus,
    },
};
use crate::error::{ApiError, ApiResult};
use crate::services::{explorer::ExplorerService, transfers::TransferService};

#[derive(Clone)]
pub struct OperationQueueService {
    queue: OperationQueue,
    explorer: ExplorerService,
    transfers: TransferService,
    payloads: Arc<Mutex<HashMap<u64, QueuedExplorerOperation>>>,
    cancellations: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
    pumping: Arc<AtomicBool>,
}

#[derive(Clone)]
enum QueuedExplorerOperation {
    Create(CreateItemRequest),
    Rename(RenameItemRequest),
    Delete(DeleteItemsRequest),
    Paste(PasteItemsRequest),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExecutionOutcome {
    Completed,
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
            pumping: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn enqueue_paste_items(
        &self,
        request: PasteItemsRequest,
    ) -> ApiResult<OperationQueueSnapshot> {
        if request.sources.is_empty() {
            return Ok(self.queue.snapshot().await);
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
            descriptors.push(OperationDescriptor {
                kind: match request.operation {
                    ClipboardOperation::Copy => OperationKind::Copy,
                    ClipboardOperation::Move => OperationKind::Move,
                },
                source: OperationEndpoint {
                    local_path: source.path.clone(),
                    ..OperationEndpoint::default()
                },
                target: OperationEndpoint {
                    local_path: target_path,
                    ..OperationEndpoint::default()
                },
                supports_replace: true,
                supports_keep_both: true,
                title: format!(
                    "{} {}",
                    match request.operation {
                        ClipboardOperation::Copy => "Copy",
                        ClipboardOperation::Move => "Move",
                    },
                    file_name
                ),
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
        Ok(self.queue.snapshot().await)
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
                target: local_endpoint(target_path),
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
                source: local_endpoint(request.path.clone()),
                target: local_endpoint(target_path),
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
            return Ok(self.queue.snapshot().await);
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
                source: local_endpoint(item.path.clone()),
                target: local_endpoint(target_path),
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
            return Ok(self.queue.snapshot().await);
        }
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
                source: local_endpoint(path.clone()),
                title: format!("Delete {name}"),
                ..OperationDescriptor::default()
            });
            payloads.push(QueuedExplorerOperation::Delete(DeleteItemsRequest {
                paths: vec![path],
            }));
        }
        self.enqueue_operations("Delete items", false, descriptors, payloads)
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
        descriptors: Vec<OperationDescriptor>,
        payloads: Vec<QueuedExplorerOperation>,
    ) -> ApiResult<(OperationQueueSnapshot, Vec<u64>)> {
        if descriptors.len() != payloads.len() {
            return Err(ApiError::Message(
                "Operation descriptors and payloads are out of sync.".to_string(),
            ));
        }
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
        Ok((self.queue.snapshot().await, operation_ids))
    }

    pub async fn enqueue_file_sync_apply(
        &self,
        label: impl Into<String>,
        copy_requests: Vec<PasteItemsRequest>,
        delete_paths: Vec<String>,
    ) -> ApiResult<(OperationQueueSnapshot, Vec<u64>)> {
        if copy_requests.is_empty() && delete_paths.is_empty() {
            return Ok((self.queue.snapshot().await, Vec::new()));
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
                descriptors.push(OperationDescriptor {
                    kind: match request.operation {
                        ClipboardOperation::Copy => OperationKind::Copy,
                        ClipboardOperation::Move => OperationKind::Move,
                    },
                    source: local_endpoint(source.path.clone()),
                    target: local_endpoint(target_path),
                    supports_replace: true,
                    supports_keep_both: true,
                    title: format!(
                        "{} {}",
                        match request.operation {
                            ClipboardOperation::Copy => "Copy",
                            ClipboardOperation::Move => "Move",
                        },
                        file_name
                    ),
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
                source: local_endpoint(path.clone()),
                title: format!("Delete {name}"),
                ..OperationDescriptor::default()
            });
            payloads.push(QueuedExplorerOperation::Delete(DeleteItemsRequest {
                paths: vec![path],
            }));
        }

        self.enqueue_operations_with_ids(label, false, descriptors, payloads)
            .await
    }

    pub async fn snapshot(&self) -> OperationQueueSnapshot {
        self.queue.snapshot().await
    }

    pub async fn cancel(&self, operation_id: u64) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.cancel(operation_id).await {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} cannot be canceled."
            )));
        }
        if let Some(token) = self.cancellations.lock().await.get(&operation_id).cloned() {
            token.store(true, Ordering::SeqCst);
        }
        self.prune_non_retryable_payloads().await;
        self.schedule_pump();
        Ok(self.queue.snapshot().await)
    }

    pub async fn retry(&self, operation_id: u64) -> ApiResult<OperationQueueSnapshot> {
        if !self.queue.retry(operation_id).await {
            return Err(ApiError::Message(format!(
                "Operation {operation_id} cannot be retried."
            )));
        }
        self.schedule_pump();
        Ok(self.queue.snapshot().await)
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
        Ok(snapshot)
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
        Ok(self.queue.snapshot().await)
    }

    pub async fn clear_terminal(&self) -> OperationQueueSnapshot {
        self.queue.clear_terminal().await;
        self.prune_missing_payloads().await;
        self.queue.snapshot().await
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
                .enqueue_rename_item(RenameItemRequest {
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
        self.enqueue_rename_item(RenameItemRequest {
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
                .enqueue_paste_items(PasteItemsRequest {
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
        self.enqueue_paste_items(PasteItemsRequest {
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
                        match worker.execute(operation, cancellation.clone()).await {
                            Ok(ExecutionOutcome::Completed) => {
                                worker.queue.complete(operation_id, None).await;
                                worker.payloads.lock().await.remove(&operation_id);
                            }
                            Ok(ExecutionOutcome::WaitingForConflict) => {}
                            Err(error) => {
                                worker
                                    .queue
                                    .complete(operation_id, Some(error.to_string()))
                                    .await;
                            }
                        }
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
        match payload {
            QueuedExplorerOperation::Create(request) => {
                self.explorer
                    .create_item_with_cancellation(request, cancellation.clone())
                    .await?;
            }
            QueuedExplorerOperation::Rename(request) => {
                self.explorer
                    .rename_item_with_cancellation(request, cancellation.clone())
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
                                        },
                                        cancellation.clone(),
                                    )
                                    .await?;
                            }
                            ConflictPolicy::Skip => {
                                return Ok(ExecutionOutcome::Completed);
                            }
                            ConflictPolicy::KeepBoth => {
                                ensure_not_canceled(&cancellation)?;
                                let keep_both_destination =
                                    self.available_keep_both_destination(&destination).await?;
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
        }
        ensure_not_canceled(&cancellation)?;
        Ok(ExecutionOutcome::Completed)
    }

    async fn available_keep_both_destination(&self, path: &Path) -> ApiResult<PathBuf> {
        if self
            .explorer
            .item_is_directory(&path.to_string_lossy())
            .await?
            .is_none()
        {
            return Ok(path.to_path_buf());
        }
        for index in 1..10_000 {
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

fn local_endpoint(path: String) -> OperationEndpoint {
    OperationEndpoint {
        local_path: path,
        ..OperationEndpoint::default()
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
    fn remote_parent_for_path_keeps_root_parent() {
        assert_eq!(remote_parent_for_path("/photo.png").unwrap(), "/");
        assert_eq!(
            remote_parent_for_path("/source/photo.png").unwrap(),
            "/source"
        );
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
