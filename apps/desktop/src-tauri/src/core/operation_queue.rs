use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    #[default]
    Copy,
    Move,
    Create,
    Rename,
    Delete,
    Download,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConflictPolicy {
    #[default]
    Ask,
    Replace,
    Skip,
    KeepBoth,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus {
    #[default]
    Queued,
    InProgress,
    WaitingForResolution,
    Completed,
    Failed,
    Canceled,
    Skipped,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationEndpoint {
    pub local_path: String,
    pub remote_name: String,
    pub remote_path: String,
}

impl OperationEndpoint {
    pub fn is_remote(&self) -> bool {
        !self.remote_name.is_empty()
    }

    pub fn display(&self) -> String {
        if self.is_remote() {
            format!("{}:{}", self.remote_name, self.remote_path)
        } else {
            self.local_path.clone()
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationDescriptor {
    pub operation_id: u64,
    pub transfer_id: u64,
    pub batch_id: u64,
    pub kind: OperationKind,
    pub source: OperationEndpoint,
    pub target: OperationEndpoint,
    pub conflict_policy: ConflictPolicy,
    pub status: OperationStatus,
    pub preserve_order: bool,
    pub retryable: bool,
    pub cancelable: bool,
    pub undoable: bool,
    pub supports_replace: bool,
    pub supports_keep_both: bool,
    pub title: String,
    pub error_message: String,
    pub attempt: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OperationBatch {
    pub batch_id: u64,
    pub label: String,
    pub preserve_order: bool,
    pub paused: bool,
    pub paused_operation_id: u64,
    pub operation_ids: Vec<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictDialogState {
    pub open: bool,
    pub operation_id: u64,
    pub batch_id: u64,
    pub apply_to_batch: bool,
    pub supports_keep_both: bool,
    pub selected_policy: ConflictPolicy,
    pub title: String,
    pub source_label: String,
    pub target_label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationQueueSnapshot {
    pub operations: Vec<OperationDescriptor>,
    pub batches: Vec<OperationBatch>,
    pub conflict_dialog: ConflictDialogState,
    pub active_count: usize,
    pub max_concurrent: usize,
}

#[derive(Default)]
struct OperationQueueInner {
    operations: HashMap<u64, OperationDescriptor>,
    batches: HashMap<u64, OperationBatch>,
    pending: VecDeque<u64>,
    conflict_dialog: ConflictDialogState,
    active_count: usize,
    max_concurrent: usize,
    next_operation_id: u64,
    next_batch_id: u64,
}

#[derive(Clone, Default)]
pub struct OperationQueue {
    inner: Arc<Mutex<OperationQueueInner>>,
}

impl OperationQueue {
    pub fn new(max_concurrent: usize) -> Self {
        let inner = OperationQueueInner {
            max_concurrent: max_concurrent.max(1),
            ..OperationQueueInner::default()
        };
        Self {
            inner: Arc::new(Mutex::new(inner)),
        }
    }

    pub async fn enqueue_batch(
        &self,
        label: impl Into<String>,
        preserve_order: bool,
        descriptors: Vec<OperationDescriptor>,
    ) -> u64 {
        self.enqueue_batch_with_ids(label, preserve_order, descriptors)
            .await
            .0
    }

    pub async fn enqueue_batch_with_ids(
        &self,
        label: impl Into<String>,
        preserve_order: bool,
        descriptors: Vec<OperationDescriptor>,
    ) -> (u64, Vec<u64>) {
        let mut inner = self.inner.lock().await;
        inner.next_batch_id += 1;
        let batch_id = inner.next_batch_id;
        let mut ids = Vec::with_capacity(descriptors.len());
        for mut descriptor in descriptors {
            inner.next_operation_id += 1;
            descriptor.operation_id = inner.next_operation_id;
            descriptor.batch_id = batch_id;
            descriptor.preserve_order = preserve_order;
            descriptor.status = OperationStatus::Queued;
            descriptor.retryable = true;
            descriptor.cancelable = true;
            ids.push(descriptor.operation_id);
            inner.pending.push_back(descriptor.operation_id);
            inner.operations.insert(descriptor.operation_id, descriptor);
        }
        inner.batches.insert(
            batch_id,
            OperationBatch {
                batch_id,
                label: label.into(),
                preserve_order,
                operation_ids: ids.clone(),
                ..OperationBatch::default()
            },
        );
        (batch_id, ids)
    }

    pub async fn take_ready(&self) -> Vec<OperationDescriptor> {
        let mut inner = self.inner.lock().await;
        let available = inner.max_concurrent.saturating_sub(inner.active_count);
        let mut ready = Vec::with_capacity(available);
        while ready.len() < available {
            let Some(id) = inner.pending.pop_front() else {
                break;
            };
            let Some(candidate) = inner.operations.get(&id) else {
                continue;
            };
            let blocked = inner.batches.get(&candidate.batch_id).is_some_and(|batch| {
                batch.paused
                    || (batch.preserve_order
                        && batch.operation_ids.iter().any(|prior| {
                            *prior != id
                                && inner.operations.get(prior).is_some_and(|operation| {
                                    operation.operation_id < id && !terminal(operation.status)
                                })
                        }))
            });
            if blocked {
                inner.pending.push_back(id);
                if inner.pending.iter().all(|queued| {
                    *queued == id
                        || ready
                            .iter()
                            .any(|item: &OperationDescriptor| item.operation_id == *queued)
                }) {
                    break;
                }
                continue;
            }
            let operation = inner.operations.get_mut(&id).expect("operation exists");
            operation.status = OperationStatus::InProgress;
            operation.attempt += 1;
            ready.push(operation.clone());
            inner.active_count += 1;
        }
        ready
    }

    pub async fn wait_for_conflict(&self, operation_id: u64) -> bool {
        let mut inner = self.inner.lock().await;
        let Some(was_active) = inner
            .operations
            .get(&operation_id)
            .map(|operation| operation.status == OperationStatus::InProgress)
        else {
            return false;
        };
        if was_active {
            inner.active_count = inner.active_count.saturating_sub(1);
        }
        let operation = inner
            .operations
            .get_mut(&operation_id)
            .expect("operation exists");
        operation.status = OperationStatus::WaitingForResolution;
        let operation = operation.clone();
        if let Some(batch) = inner.batches.get_mut(&operation.batch_id) {
            batch.paused = true;
            batch.paused_operation_id = operation_id;
        }
        inner.conflict_dialog = ConflictDialogState {
            open: true,
            operation_id,
            batch_id: operation.batch_id,
            apply_to_batch: true,
            supports_keep_both: operation.supports_keep_both,
            selected_policy: ConflictPolicy::Replace,
            title: operation.title.clone(),
            source_label: operation.source.display(),
            target_label: operation.target.display(),
        };
        true
    }

    pub async fn resolve_conflict(
        &self,
        operation_id: u64,
        policy: ConflictPolicy,
        apply_to_batch: bool,
    ) -> bool {
        let mut inner = self.inner.lock().await;
        let Some(operation) = inner.operations.get(&operation_id).cloned() else {
            return false;
        };
        let affected = if apply_to_batch {
            inner
                .batches
                .get(&operation.batch_id)
                .map(|batch| batch.operation_ids.clone())
                .unwrap_or_default()
        } else {
            vec![operation_id]
        };
        for id in affected {
            if let Some(item) = inner.operations.get_mut(&id) {
                item.conflict_policy = policy;
                if item.status == OperationStatus::WaitingForResolution {
                    item.status = if policy == ConflictPolicy::Skip {
                        OperationStatus::Skipped
                    } else {
                        OperationStatus::Queued
                    };
                    if item.status == OperationStatus::Queued {
                        inner.pending.push_front(id);
                    }
                }
            }
        }
        if let Some(batch) = inner.batches.get_mut(&operation.batch_id) {
            batch.paused = false;
            batch.paused_operation_id = 0;
        }
        inner.conflict_dialog = ConflictDialogState::default();
        true
    }

    pub async fn complete(&self, operation_id: u64, error: Option<String>) -> bool {
        let mut inner = self.inner.lock().await;
        let Some(status) = inner
            .operations
            .get(&operation_id)
            .map(|operation| operation.status)
        else {
            return false;
        };
        if status == OperationStatus::Canceled {
            return true;
        }
        if status == OperationStatus::InProgress {
            inner.active_count = inner.active_count.saturating_sub(1);
        }
        let operation = inner
            .operations
            .get_mut(&operation_id)
            .expect("operation exists");
        operation.status = if error.is_some() {
            OperationStatus::Failed
        } else {
            OperationStatus::Completed
        };
        operation.error_message = error.unwrap_or_default();
        true
    }

    pub async fn cancel(&self, operation_id: u64) -> bool {
        let mut inner = self.inner.lock().await;
        let Some(operation) = inner.operations.get_mut(&operation_id) else {
            return false;
        };
        if !operation.cancelable
            || !matches!(
                operation.status,
                OperationStatus::Queued
                    | OperationStatus::InProgress
                    | OperationStatus::WaitingForResolution
            )
        {
            return false;
        }
        let was_active = operation.status == OperationStatus::InProgress;
        let batch_id = operation.batch_id;
        operation.status = OperationStatus::Canceled;
        operation.cancelable = false;
        if was_active {
            inner.active_count = inner.active_count.saturating_sub(1);
        }
        inner.pending.retain(|id| *id != operation_id);
        if inner.conflict_dialog.operation_id == operation_id {
            inner.conflict_dialog = ConflictDialogState::default();
        }
        if let Some(batch) = inner.batches.get_mut(&batch_id) {
            if batch.paused_operation_id == operation_id {
                batch.paused = false;
                batch.paused_operation_id = 0;
            }
        }
        true
    }

    pub async fn retry(&self, operation_id: u64) -> bool {
        let mut inner = self.inner.lock().await;
        let Some(operation) = inner.operations.get_mut(&operation_id) else {
            return false;
        };
        if !operation.retryable || operation.status != OperationStatus::Failed {
            return false;
        }
        operation.status = OperationStatus::Queued;
        operation.error_message.clear();
        inner.pending.push_back(operation_id);
        true
    }

    pub async fn snapshot(&self) -> OperationQueueSnapshot {
        let inner = self.inner.lock().await;
        let mut operations: Vec<_> = inner.operations.values().cloned().collect();
        operations.sort_by_key(|operation| operation.operation_id);
        let mut batches: Vec<_> = inner.batches.values().cloned().collect();
        batches.sort_by_key(|batch| batch.batch_id);
        OperationQueueSnapshot {
            operations,
            batches,
            conflict_dialog: inner.conflict_dialog.clone(),
            active_count: inner.active_count,
            max_concurrent: inner.max_concurrent,
        }
    }

    pub async fn clear_terminal(&self) {
        let mut inner = self.inner.lock().await;
        inner
            .operations
            .retain(|_, operation| !terminal(operation.status));
        let remaining: std::collections::HashSet<_> = inner.operations.keys().copied().collect();
        inner
            .batches
            .retain(|_, batch| batch.operation_ids.iter().any(|id| remaining.contains(id)));
    }
}

fn terminal(status: OperationStatus) -> bool {
    matches!(
        status,
        OperationStatus::Completed
            | OperationStatus::Failed
            | OperationStatus::Canceled
            | OperationStatus::Skipped
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(title: &str) -> OperationDescriptor {
        OperationDescriptor {
            title: title.into(),
            supports_replace: true,
            supports_keep_both: true,
            ..OperationDescriptor::default()
        }
    }

    #[tokio::test]
    async fn preserved_batch_waits_for_conflict_resolution() {
        let queue = OperationQueue::new(2);
        queue
            .enqueue_batch("copy", true, vec![descriptor("one"), descriptor("two")])
            .await;
        let first = queue.take_ready().await;
        assert_eq!(first.len(), 1);
        assert!(queue.wait_for_conflict(first[0].operation_id).await);
        assert!(queue.take_ready().await.is_empty());
        assert!(
            queue
                .resolve_conflict(first[0].operation_id, ConflictPolicy::Replace, true)
                .await
        );
        assert_eq!(queue.take_ready().await.len(), 1);
    }

    #[tokio::test]
    async fn failed_operation_can_retry_and_canceled_operation_cannot() {
        let queue = OperationQueue::new(1);
        queue
            .enqueue_batch("copy", false, vec![descriptor("one"), descriptor("two")])
            .await;
        let first = queue.take_ready().await.remove(0);
        assert!(
            queue
                .complete(first.operation_id, Some("failed".into()))
                .await
        );
        assert!(queue.retry(first.operation_id).await);
        let snapshot = queue.snapshot().await;
        let second = snapshot
            .operations
            .iter()
            .find(|item| item.operation_id != first.operation_id)
            .unwrap();
        assert!(queue.cancel(second.operation_id).await);
        assert!(!queue.retry(second.operation_id).await);
    }

    #[tokio::test]
    async fn in_progress_operation_can_cancel_without_late_completion_overwrite() {
        let queue = OperationQueue::new(1);
        queue
            .enqueue_batch("copy", false, vec![descriptor("one")])
            .await;
        let first = queue.take_ready().await.remove(0);
        assert!(queue.cancel(first.operation_id).await);
        assert!(queue.complete(first.operation_id, None).await);

        let snapshot = queue.snapshot().await;
        let operation = snapshot
            .operations
            .iter()
            .find(|operation| operation.operation_id == first.operation_id)
            .unwrap();
        assert_eq!(operation.status, OperationStatus::Canceled);
        assert_eq!(snapshot.active_count, 0);
    }

    #[tokio::test]
    async fn canceling_conflict_operation_unpauses_batch() {
        let queue = OperationQueue::new(1);
        queue
            .enqueue_batch("copy", true, vec![descriptor("one"), descriptor("two")])
            .await;
        let first = queue.take_ready().await.remove(0);
        assert!(queue.wait_for_conflict(first.operation_id).await);
        assert!(queue.cancel(first.operation_id).await);
        assert_eq!(queue.take_ready().await.len(), 1);
    }
}
