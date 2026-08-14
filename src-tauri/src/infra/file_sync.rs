use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::{
    domain::{
        explorer::{ClipboardOperation, ListDirectoryRequest, PasteItem, PasteItemsRequest},
        file_sync::{
            capture_local_snapshot, compare_file_sync_snapshots, planned_rows_for_apply,
            FileSyncCompareDisposition, FileSyncCompareResult, FileSyncCompareSide,
            FileSyncEndpoint, FileSyncEndpointKind, FileSyncMaster, FileSyncMasterExecutor,
            FileSyncPair, FileSyncPairStore, FileSyncPlannedAction, FileSyncPolicy,
            FileSyncSnapshot,
        },
    },
    error::{ApiError, ApiResult},
    infra::{
        environment::AppEnvironmentService, explorer::ExplorerService,
        operation_queue::OperationQueueService,
    },
};

#[derive(Clone)]
pub struct FileSyncService {
    explorer: ExplorerService,
    operation_queue: OperationQueueService,
    pairs: FileSyncPairStore,
    mount_root: PathBuf,
    master: FileSyncMaster,
    watch_apply_operations: Arc<Mutex<HashMap<i64, Vec<u64>>>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncCompareRequest {
    pub left: FileSyncEndpoint,
    pub right: FileSyncEndpoint,
    pub pair_id: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncApplyRequest {
    pub left: FileSyncEndpoint,
    pub right: FileSyncEndpoint,
    pub rows: Vec<crate::domain::file_sync::FileSyncCompareRow>,
    pub pair_id: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncApplyResult {
    pub applied_count: usize,
    pub affected_paths: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct FileSyncApplyQueuePlan {
    pub copy_requests: Vec<PasteItemsRequest>,
    pub delete_paths: Vec<String>,
    pub affected_paths: Vec<String>,
}

impl FileSyncApplyQueuePlan {
    pub fn operation_count(&self) -> usize {
        self.copy_requests.len() + self.delete_paths.len()
    }
}

impl FileSyncService {
    pub fn new(
        environment: AppEnvironmentService,
        explorer: ExplorerService,
        operation_queue: OperationQueueService,
        pairs: FileSyncPairStore,
    ) -> Self {
        Self {
            explorer,
            operation_queue,
            pairs,
            mount_root: environment.mount_root(),
            master: FileSyncMaster::new(),
            watch_apply_operations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn pairs_snapshot(&self) -> ApiResult<Vec<FileSyncPair>> {
        let pairs = self.pairs.load_all().await?;
        for pair in pairs.iter().filter(|pair| pair.watch_mode) {
            self.start_watcher(pair.clone()).await;
        }
        Ok(pairs)
    }

    pub async fn save_pair(&self, pair: FileSyncPair) -> ApiResult<FileSyncPair> {
        let saved = self.pairs.save(pair).await?;
        if saved.watch_mode {
            self.start_watcher(saved.clone()).await;
        } else {
            self.stop_watcher(saved.id).await;
        }
        Ok(saved)
    }

    pub async fn remove_pair(&self, pair_id: i64) -> ApiResult<()> {
        self.stop_watcher(pair_id).await;
        self.pairs.remove(pair_id).await
    }

    pub async fn compare(&self, request: FileSyncCompareRequest) -> FileSyncCompareResult {
        if request.left.empty() || request.right.empty() {
            return compare_error("Both compare roots are required.");
        }
        let (left, right) = tokio::join!(
            self.capture_snapshot(&request.left),
            self.capture_snapshot(&request.right)
        );
        let (left, right) = match (left, right) {
            (Ok(left), Ok(right)) => (left, right),
            (Err(error), _) | (_, Err(error)) => return compare_error(error.to_string()),
        };
        let result = compare_file_sync_snapshots(&left, &right);
        if let Some(pair_id) = request.pair_id.filter(|id| *id > 0) {
            if let Ok(pairs) = self.pairs.load_all().await {
                if let Some(mut pair) = pairs.into_iter().find(|pair| pair.id == pair_id) {
                    pair.left = request.left;
                    pair.right = request.right;
                    pair.stale = false;
                    pair.last_compared_at_ms = result.compared_at_ms;
                    pair.last_scan_at_ms = result.compared_at_ms;
                    let _ = self.pairs.save(pair).await;
                }
            }
        }
        result
    }

    pub async fn apply(&self, request: FileSyncApplyRequest) -> ApiResult<FileSyncApplyResult> {
        self.enqueue_apply(request, None)
            .await
            .map(|(result, _)| result)
    }

    pub async fn enqueue_apply(
        &self,
        request: FileSyncApplyRequest,
        label: Option<String>,
    ) -> ApiResult<(FileSyncApplyResult, Vec<u64>)> {
        let plan = self.apply_queue_plan(&request)?;
        let applied_count = plan.operation_count();
        let affected_paths = plan.affected_paths;
        let (_, operation_ids) = self
            .operation_queue
            .enqueue_file_sync_apply(
                label.unwrap_or_else(|| "File sync apply".to_string()),
                plan.copy_requests,
                plan.delete_paths,
            )
            .await?;
        self.mark_apply_queued(request.pair_id).await;
        Ok((
            FileSyncApplyResult {
                applied_count,
                affected_paths,
            },
            operation_ids,
        ))
    }

    pub fn apply_queue_plan(
        &self,
        request: &FileSyncApplyRequest,
    ) -> ApiResult<FileSyncApplyQueuePlan> {
        let planned = planned_rows_for_apply(&request.rows);
        let mut plan = FileSyncApplyQueuePlan::default();
        for row in planned {
            match row.action {
                FileSyncPlannedAction::CopyLeftToRight => {
                    let request = self.copy_side_queue_request(
                        &row.left,
                        &request.right,
                        &row.relative_path,
                    )?;
                    plan.affected_paths
                        .push(request.destination_directory.clone());
                    plan.affected_paths.push(row.left.absolute_path.clone());
                    plan.copy_requests.push(request);
                }
                FileSyncPlannedAction::CopyRightToLeft => {
                    let request = self.copy_side_queue_request(
                        &row.right,
                        &request.left,
                        &row.relative_path,
                    )?;
                    plan.affected_paths
                        .push(request.destination_directory.clone());
                    plan.affected_paths.push(row.right.absolute_path.clone());
                    plan.copy_requests.push(request);
                }
                FileSyncPlannedAction::DeleteLeft => {
                    if row.left.present {
                        plan.affected_paths.push(row.left.absolute_path.clone());
                        plan.delete_paths.push(row.left.absolute_path.clone());
                    }
                }
                FileSyncPlannedAction::DeleteRight => {
                    if row.right.present {
                        plan.affected_paths.push(row.right.absolute_path.clone());
                        plan.delete_paths.push(row.right.absolute_path.clone());
                    }
                }
                FileSyncPlannedAction::Skip => {}
            }
        }
        plan.affected_paths.sort();
        plan.affected_paths.dedup();
        Ok(plan)
    }

    pub async fn mark_apply_queued(&self, pair_id: Option<i64>) {
        let Some(pair_id) = pair_id.filter(|id| *id > 0) else {
            return;
        };
        if let Ok(pairs) = self.pairs.load_all().await {
            if let Some(mut pair) = pairs.into_iter().find(|pair| pair.id == pair_id) {
                pair.stale = false;
                pair.last_scan_at_ms = crate::domain::file_transfer::now_epoch_ms();
                let _ = self.pairs.save(pair).await;
            }
        }
    }

    async fn start_watcher(&self, pair: FileSyncPair) {
        if pair.id <= 0 {
            return;
        }
        let service = self.clone();
        let executor: FileSyncMasterExecutor = Arc::new(move |pair_id| {
            let service = service.clone();
            Box::pin(async move { service.sync_saved_pair(pair_id).await })
        });
        // Two local folders change by filesystem notification, so they compare
        // when something changes plus a slow safety pass. A remote side has no
        // change feed and keeps the short compare interval.
        let (interval, trigger, guard) = match local_pair_watcher(&pair) {
            Some((watcher, trigger)) => (
                Duration::from_secs(600),
                Some(trigger),
                Some(Box::new(watcher) as Box<dyn Send>),
            ),
            None => (Duration::from_secs(5), None, None),
        };
        let _ = self
            .master
            .start_triggered(pair.id, interval, executor, trigger, guard)
            .await;
    }

    async fn stop_watcher(&self, pair_id: i64) {
        self.master.stop(pair_id).await;
    }

    async fn sync_saved_pair(&self, pair_id: i64) -> ApiResult<bool> {
        let Some(mut pair) = self
            .pairs
            .load_all()
            .await?
            .into_iter()
            .find(|candidate| candidate.id == pair_id)
        else {
            return Ok(false);
        };
        if !pair.watch_mode {
            return Ok(false);
        }

        let comparison = self
            .compare(FileSyncCompareRequest {
                left: pair.left.clone(),
                right: pair.right.clone(),
                pair_id: None,
            })
            .await;
        if !comparison.success {
            pair.stale = true;
            pair.last_scan_at_ms = crate::domain::file_transfer::now_epoch_ms();
            let _ = self.pairs.save(pair).await;
            return Ok(true);
        }

        let rows = watched_actions(&pair, comparison.rows);
        let unresolved = rows.iter().any(|row| {
            matches!(
                row.disposition,
                FileSyncCompareDisposition::Different | FileSyncCompareDisposition::Conflict
            ) && row.action == FileSyncPlannedAction::Skip
        });
        if rows
            .iter()
            .any(|row| row.action != FileSyncPlannedAction::Skip)
        {
            if self.watch_apply_pending(pair.id).await {
                pair.stale = unresolved;
                pair.last_compared_at_ms = comparison.compared_at_ms;
                pair.last_scan_at_ms = comparison.compared_at_ms;
                self.pairs.save(pair).await?;
                return Ok(true);
            }
            let (_, operation_ids) = self
                .enqueue_apply(
                    FileSyncApplyRequest {
                        left: pair.left.clone(),
                        right: pair.right.clone(),
                        rows,
                        pair_id: None,
                    },
                    Some(format!("File sync apply {}", pair_display_name(&pair))),
                )
                .await?;
            if !operation_ids.is_empty() {
                self.watch_apply_operations
                    .lock()
                    .await
                    .insert(pair.id, operation_ids);
            }
        }
        pair.stale = unresolved;
        pair.last_compared_at_ms = comparison.compared_at_ms;
        pair.last_scan_at_ms = comparison.compared_at_ms;
        self.pairs.save(pair).await?;
        Ok(true)
    }

    async fn capture_snapshot(&self, endpoint: &FileSyncEndpoint) -> ApiResult<FileSyncSnapshot> {
        match endpoint.kind {
            FileSyncEndpointKind::Local => {
                let root = PathBuf::from(&endpoint.local_path);
                tokio::task::spawn_blocking(move || capture_local_snapshot(&root))
                    .await
                    .map_err(|error| ApiError::Message(format!("Compare worker failed: {error}")))?
            }
            FileSyncEndpointKind::Remote => self.capture_remote_snapshot(endpoint).await,
        }
    }

    async fn capture_remote_snapshot(
        &self,
        endpoint: &FileSyncEndpoint,
    ) -> ApiResult<FileSyncSnapshot> {
        if endpoint.remote_name.is_empty() {
            return Err(ApiError::Message(
                "Remote compare root is missing a remote name.".into(),
            ));
        }
        let root = self.endpoint_path(endpoint);
        let mut pending = vec![root.clone()];
        let mut snapshot = FileSyncSnapshot::new();
        while let Some(directory) = pending.pop() {
            let listing = self
                .explorer
                .list_directory(ListDirectoryRequest {
                    path: Some(directory.to_string_lossy().to_string()),
                    show_hidden: Some(true),
                    force_remote_refresh: None,
                })
                .await?;
            for entry in listing.entries {
                let entry_path = PathBuf::from(&entry.path);
                let relative = relative_path(&root, &entry_path);
                let is_dir = matches!(entry.kind, crate::domain::explorer::FileKind::Folder);
                snapshot.insert(
                    relative,
                    FileSyncCompareSide {
                        present: true,
                        is_remote: true,
                        is_dir,
                        size: entry.size_bytes.unwrap_or_default().min(i64::MAX as u64) as i64,
                        last_modified: entry.remote_modified.unwrap_or_default(),
                        absolute_path: entry.path.clone(),
                        remote_name: entry
                            .location
                            .remote_name
                            .unwrap_or_else(|| endpoint.remote_name.clone()),
                        remote_path: entry.location.remote_path.unwrap_or_default(),
                    },
                );
                if is_dir {
                    pending.push(entry_path);
                }
            }
        }
        Ok(snapshot)
    }

    fn copy_side_queue_request(
        &self,
        source: &FileSyncCompareSide,
        destination_root: &FileSyncEndpoint,
        relative_path: &str,
    ) -> ApiResult<PasteItemsRequest> {
        if !source.present {
            return Err(ApiError::Message("Compare source no longer exists.".into()));
        }
        let destination = self.endpoint_path(destination_root);
        let parent = Path::new(relative_path)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        Ok(PasteItemsRequest {
            sources: vec![PasteItem {
                path: source.absolute_path.clone(),
                is_directory: source.is_dir,
                size_bytes: None,
                remote_modified: None,
            }],
            destination_directory: destination.join(parent).to_string_lossy().to_string(),
            operation: ClipboardOperation::Copy,
            target_name: None,
        })
    }

    fn endpoint_path(&self, endpoint: &FileSyncEndpoint) -> PathBuf {
        match endpoint.kind {
            FileSyncEndpointKind::Local => PathBuf::from(&endpoint.local_path),
            FileSyncEndpointKind::Remote => {
                let mut path = self.mount_root.join(&endpoint.remote_name);
                for component in
                    Path::new(endpoint.remote_path.trim_start_matches('/')).components()
                {
                    path.push(component);
                }
                path
            }
        }
    }

    async fn watch_apply_pending(&self, pair_id: i64) -> bool {
        let Some(operation_ids) = self
            .watch_apply_operations
            .lock()
            .await
            .get(&pair_id)
            .cloned()
        else {
            return false;
        };
        let operation_ids: HashSet<_> = operation_ids.into_iter().collect();
        let snapshot = self.operation_queue.snapshot().await;
        let pending = snapshot.operations.iter().any(|operation| {
            operation_ids.contains(&operation.operation_id)
                && !terminal_operation_status(operation.status)
        });
        if !pending {
            self.watch_apply_operations.lock().await.remove(&pair_id);
        }
        pending
    }
}

fn terminal_operation_status(status: crate::domain::operation_queue::OperationStatus) -> bool {
    matches!(
        status,
        crate::domain::operation_queue::OperationStatus::Completed
            | crate::domain::operation_queue::OperationStatus::Failed
            | crate::domain::operation_queue::OperationStatus::Canceled
            | crate::domain::operation_queue::OperationStatus::Skipped
    )
}

fn watched_actions(
    pair: &FileSyncPair,
    mut rows: Vec<crate::domain::file_sync::FileSyncCompareRow>,
) -> Vec<crate::domain::file_sync::FileSyncCompareRow> {
    for row in &mut rows {
        row.action = match row.disposition {
            FileSyncCompareDisposition::Same => FileSyncPlannedAction::Skip,
            FileSyncCompareDisposition::Conflict => FileSyncPlannedAction::Skip,
            FileSyncCompareDisposition::Different => authoritative_copy(pair),
            FileSyncCompareDisposition::LeftOnly => match pair.preferred_policy {
                FileSyncPolicy::BiDirectional => FileSyncPlannedAction::CopyLeftToRight,
                _ if left_is_authoritative(pair) => FileSyncPlannedAction::CopyLeftToRight,
                _ => FileSyncPlannedAction::DeleteLeft,
            },
            FileSyncCompareDisposition::RightOnly => match pair.preferred_policy {
                FileSyncPolicy::BiDirectional => FileSyncPlannedAction::CopyRightToLeft,
                _ if right_is_authoritative(pair) => FileSyncPlannedAction::CopyRightToLeft,
                _ => FileSyncPlannedAction::DeleteRight,
            },
        };
    }
    rows
}

fn authoritative_copy(pair: &FileSyncPair) -> FileSyncPlannedAction {
    if left_is_authoritative(pair) {
        FileSyncPlannedAction::CopyLeftToRight
    } else if right_is_authoritative(pair) {
        FileSyncPlannedAction::CopyRightToLeft
    } else {
        FileSyncPlannedAction::Skip
    }
}

fn left_is_authoritative(pair: &FileSyncPair) -> bool {
    matches!(
        (pair.preferred_policy, pair.left.kind),
        (FileSyncPolicy::LocalFirst, FileSyncEndpointKind::Local)
            | (FileSyncPolicy::RemoteFirst, FileSyncEndpointKind::Remote)
    )
}

fn right_is_authoritative(pair: &FileSyncPair) -> bool {
    matches!(
        (pair.preferred_policy, pair.right.kind),
        (FileSyncPolicy::LocalFirst, FileSyncEndpointKind::Local)
            | (FileSyncPolicy::RemoteFirst, FileSyncEndpointKind::Remote)
    )
}

fn compare_error(message: impl Into<String>) -> FileSyncCompareResult {
    FileSyncCompareResult {
        error_message: message.into(),
        ..FileSyncCompareResult::default()
    }
}

fn pair_display_name(pair: &FileSyncPair) -> String {
    let name = pair.name.trim();
    if name.is_empty() {
        format!("#{}", pair.id)
    } else {
        name.to_string()
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Watches both folders of an all-local pair. Returns `None` for a pair with a
/// remote side, or when a folder cannot be watched (the caller then polls).
fn local_pair_watcher(
    pair: &FileSyncPair,
) -> Option<(notify::RecommendedWatcher, tokio::sync::mpsc::Receiver<()>)> {
    use notify::{RecursiveMode, Watcher};
    let local = |endpoint: &crate::domain::file_sync::FileSyncEndpoint| {
        (endpoint.kind == crate::domain::file_sync::FileSyncEndpointKind::Local
            && !endpoint.local_path.is_empty())
        .then(|| PathBuf::from(&endpoint.local_path))
    };
    let (left, right) = (local(&pair.left)?, local(&pair.right)?);
    let (sender, receiver) = tokio::sync::mpsc::channel(1);
    // FSEvents on macOS (see Cargo features): no per-file descriptors.
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if matches!(&event, Ok(event) if matches!(event.kind, notify::EventKind::Access(_))) {
            return;
        }
        // A full channel already holds a pending run; errors also re-run.
        let _ = sender.try_send(());
    })
    .ok()?;
    watcher.watch(&left, RecursiveMode::Recursive).ok()?;
    watcher.watch(&right, RecursiveMode::Recursive).ok()?;
    Some((watcher, receiver))
}

#[cfg(test)]
#[path = "file_sync_tests.rs"]
mod tests;
