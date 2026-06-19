use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::{
    core::{
        explorer::{
            ClipboardOperation, DeleteItemsRequest, ExplorerOperationResult, ListDirectoryRequest,
            PasteItem, PasteItemsRequest,
        },
        file_sync::{
            capture_local_snapshot, compare_file_sync_snapshots, planned_rows_for_apply,
            FileSyncCompareDisposition, FileSyncCompareResult, FileSyncCompareSide,
            FileSyncEndpoint, FileSyncEndpointKind, FileSyncMaster, FileSyncMasterExecutor,
            FileSyncPair, FileSyncPairStore, FileSyncPlannedAction, FileSyncPolicy,
            FileSyncSnapshot,
        },
    },
    error::{ApiError, ApiResult},
    services::{environment::AppEnvironmentService, explorer::ExplorerService},
};

#[derive(Clone)]
pub struct FileSyncService {
    explorer: ExplorerService,
    pairs: FileSyncPairStore,
    mount_root: PathBuf,
    master: FileSyncMaster,
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
    pub rows: Vec<crate::core::file_sync::FileSyncCompareRow>,
    pub pair_id: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncApplyResult {
    pub applied_count: usize,
    pub affected_paths: Vec<String>,
}

impl FileSyncService {
    pub fn new(
        environment: AppEnvironmentService,
        explorer: ExplorerService,
        pairs: FileSyncPairStore,
    ) -> Self {
        Self {
            explorer,
            pairs,
            mount_root: environment.mount_root(),
            master: FileSyncMaster::new(),
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
        let planned = planned_rows_for_apply(&request.rows);
        let mut result = FileSyncApplyResult::default();
        for row in planned {
            let operation = match row.action {
                FileSyncPlannedAction::CopyLeftToRight => {
                    self.copy_side(&row.left, &request.right, &row.relative_path)
                        .await
                }
                FileSyncPlannedAction::CopyRightToLeft => {
                    self.copy_side(&row.right, &request.left, &row.relative_path)
                        .await
                }
                FileSyncPlannedAction::DeleteLeft => self.delete_side(&row.left).await,
                FileSyncPlannedAction::DeleteRight => self.delete_side(&row.right).await,
                FileSyncPlannedAction::Skip => continue,
            }?;
            result.applied_count += 1;
            result.affected_paths.extend(operation.affected_paths);
        }
        if let Some(pair_id) = request.pair_id.filter(|id| *id > 0) {
            if let Ok(pairs) = self.pairs.load_all().await {
                if let Some(mut pair) = pairs.into_iter().find(|pair| pair.id == pair_id) {
                    pair.stale = false;
                    pair.last_scan_at_ms = crate::core::file_transfer::now_epoch_ms();
                    let _ = self.pairs.save(pair).await;
                }
            }
        }
        Ok(result)
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
        let _ = self
            .master
            .start(pair.id, Duration::from_secs(5), executor)
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
            pair.last_scan_at_ms = crate::core::file_transfer::now_epoch_ms();
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
            self.apply(FileSyncApplyRequest {
                left: pair.left.clone(),
                right: pair.right.clone(),
                rows,
                pair_id: None,
            })
            .await?;
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
        if endpoint.provider_type.is_empty() {
            return Err(ApiError::Message(
                "Remote compare root is missing its provider type.".into(),
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
                })
                .await?;
            for entry in listing.entries {
                let entry_path = PathBuf::from(&entry.path);
                let relative = relative_path(&root, &entry_path);
                let is_dir = matches!(entry.kind, crate::core::explorer::FileKind::Folder);
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

    async fn copy_side(
        &self,
        source: &FileSyncCompareSide,
        destination_root: &FileSyncEndpoint,
        relative_path: &str,
    ) -> ApiResult<ExplorerOperationResult> {
        if !source.present {
            return Err(ApiError::Message("Compare source no longer exists.".into()));
        }
        let destination = self.endpoint_path(destination_root);
        let parent = Path::new(relative_path)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        self.explorer
            .paste_items(PasteItemsRequest {
                sources: vec![PasteItem {
                    path: source.absolute_path.clone(),
                    is_directory: source.is_dir,
                }],
                destination_directory: destination.join(parent).to_string_lossy().to_string(),
                operation: ClipboardOperation::Copy,
                target_name: None,
            })
            .await
    }

    async fn delete_side(&self, side: &FileSyncCompareSide) -> ApiResult<ExplorerOperationResult> {
        if !side.present {
            return Ok(ExplorerOperationResult {
                affected_paths: Vec::new(),
                parent_path: None,
            });
        }
        self.explorer
            .delete_items(DeleteItemsRequest {
                paths: vec![side.absolute_path.clone()],
            })
            .await
    }

    fn endpoint_path(&self, endpoint: &FileSyncEndpoint) -> PathBuf {
        match endpoint.kind {
            FileSyncEndpointKind::Local => PathBuf::from(&endpoint.local_path),
            FileSyncEndpointKind::Remote => {
                let mut path = self
                    .mount_root
                    .join(&endpoint.provider_type)
                    .join(&endpoint.remote_name);
                for component in
                    Path::new(endpoint.remote_path.trim_start_matches('/')).components()
                {
                    path.push(component);
                }
                path
            }
        }
    }
}

fn watched_actions(
    pair: &FileSyncPair,
    mut rows: Vec<crate::core::file_sync::FileSyncCompareRow>,
) -> Vec<crate::core::file_sync::FileSyncCompareRow> {
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

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::file_sync::{
        FileSyncCompareRow, FileSyncCompareSide, FileSyncEndpoint, FileSyncEndpointKind,
    };

    fn pair(policy: FileSyncPolicy) -> FileSyncPair {
        FileSyncPair {
            left: FileSyncEndpoint {
                kind: FileSyncEndpointKind::Local,
                local_path: "/local".into(),
                ..FileSyncEndpoint::default()
            },
            right: FileSyncEndpoint {
                kind: FileSyncEndpointKind::Remote,
                remote_name: "drive".into(),
                remote_path: "/".into(),
                ..FileSyncEndpoint::default()
            },
            preferred_policy: policy,
            ..FileSyncPair::default()
        }
    }

    fn row(disposition: FileSyncCompareDisposition) -> FileSyncCompareRow {
        FileSyncCompareRow {
            disposition,
            left: FileSyncCompareSide::default(),
            right: FileSyncCompareSide::default(),
            ..FileSyncCompareRow::default()
        }
    }

    #[test]
    fn bidirectional_watch_copies_presence_and_leaves_differences_for_review() {
        let rows = watched_actions(
            &pair(FileSyncPolicy::BiDirectional),
            vec![
                row(FileSyncCompareDisposition::LeftOnly),
                row(FileSyncCompareDisposition::RightOnly),
                row(FileSyncCompareDisposition::Different),
            ],
        );
        assert_eq!(rows[0].action, FileSyncPlannedAction::CopyLeftToRight);
        assert_eq!(rows[1].action, FileSyncPlannedAction::CopyRightToLeft);
        assert_eq!(rows[2].action, FileSyncPlannedAction::Skip);
    }

    #[test]
    fn remote_first_watch_mirrors_remote_presence_to_local() {
        let rows = watched_actions(
            &pair(FileSyncPolicy::RemoteFirst),
            vec![
                row(FileSyncCompareDisposition::LeftOnly),
                row(FileSyncCompareDisposition::RightOnly),
                row(FileSyncCompareDisposition::Different),
            ],
        );
        assert_eq!(rows[0].action, FileSyncPlannedAction::DeleteLeft);
        assert_eq!(rows[1].action, FileSyncPlannedAction::CopyRightToLeft);
        assert_eq!(rows[2].action, FileSyncPlannedAction::CopyRightToLeft);
    }
}
