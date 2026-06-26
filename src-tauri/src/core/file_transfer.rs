use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferRecord {
    pub id: u64,
    pub job_id: u64,
    pub transfer_type: FileTransferType,
    pub item_type: FileTransferItemType,
    pub status: FileTransferStatus,
    pub conflict_policy: FileTransferConflictPolicy,
    pub file_name: String,
    pub local_source_path: String,
    pub local_dest_path: String,
    pub remote_source_name: String,
    pub remote_source_path: String,
    pub remote_dest_name: String,
    pub remote_dest_path: String,
    pub total_bytes: i64,
    pub transferred_bytes: i64,
    pub error_message: String,
    pub detail_message: String,
    pub queued_at_ms: i64,
    pub started_at_ms: i64,
    pub completed_at_ms: i64,
    pub cancelable: bool,
    pub retryable: bool,
    pub undoable: bool,
    pub undo_token_id: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileTransferType {
    Upload,
    Download,
    Create,
    Copy,
    Move,
    Rename,
    Delete,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileTransferItemType {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileTransferStatus {
    Queued,
    Pending,
    InProgress,
    WaitingForResolution,
    Completed,
    Failed,
    Canceled,
    Skipped,
    Interrupted,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileTransferConflictPolicy {
    Ask,
    Replace,
    Skip,
    KeepBoth,
}

impl FileTransferRecord {
    pub fn new(
        transfer_type: FileTransferType,
        item_type: FileTransferItemType,
        file_name: impl Into<String>,
    ) -> Self {
        Self {
            transfer_type,
            item_type,
            file_name: file_name.into(),
            ..Self::default()
        }
    }

    pub fn is_alive(&self) -> bool {
        self.error_message.is_empty()
            && matches!(
                self.status,
                FileTransferStatus::Queued
                    | FileTransferStatus::Pending
                    | FileTransferStatus::InProgress
                    | FileTransferStatus::WaitingForResolution
            )
    }

    pub fn mark_started(&mut self) {
        self.status = FileTransferStatus::InProgress;
        if self.started_at_ms <= 0 {
            self.started_at_ms = now_epoch_ms();
        }
        self.cancelable = false;
    }

    pub fn update_progress(&mut self, transferred_bytes: i64, total_bytes: i64) {
        self.transferred_bytes = transferred_bytes.max(0);
        if total_bytes >= 0 {
            self.total_bytes = total_bytes;
        }
        if matches!(
            self.status,
            FileTransferStatus::Queued
                | FileTransferStatus::Pending
                | FileTransferStatus::WaitingForResolution
        ) {
            self.mark_started();
        }
    }

    pub fn complete(&mut self) {
        self.status = FileTransferStatus::Completed;
        self.completed_at_ms = now_epoch_ms();
        self.cancelable = false;
        self.retryable = false;
        if self.total_bytes > 0 && self.transferred_bytes < self.total_bytes {
            self.transferred_bytes = self.total_bytes;
        }
    }

    pub fn fail(&mut self, message: impl Into<String>) {
        self.status = FileTransferStatus::Failed;
        self.error_message = message.into();
        self.completed_at_ms = now_epoch_ms();
        self.cancelable = false;
        self.retryable = true;
    }

    pub fn cancel(&mut self, detail: impl Into<String>) {
        self.status = FileTransferStatus::Canceled;
        self.detail_message = detail.into();
        self.completed_at_ms = now_epoch_ms();
        self.cancelable = false;
    }
}

impl Default for FileTransferRecord {
    fn default() -> Self {
        Self {
            id: 0,
            job_id: 0,
            transfer_type: FileTransferType::Upload,
            item_type: FileTransferItemType::Local,
            status: FileTransferStatus::Pending,
            conflict_policy: FileTransferConflictPolicy::Ask,
            file_name: String::new(),
            local_source_path: String::new(),
            local_dest_path: String::new(),
            remote_source_name: String::new(),
            remote_source_path: String::new(),
            remote_dest_name: String::new(),
            remote_dest_path: String::new(),
            total_bytes: 0,
            transferred_bytes: 0,
            error_message: String::new(),
            detail_message: String::new(),
            queued_at_ms: 0,
            started_at_ms: 0,
            completed_at_ms: 0,
            cancelable: false,
            retryable: false,
            undoable: false,
            undo_token_id: 0,
        }
    }
}

pub fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_matches_native_transfer_semantics() {
        let mut transfer = FileTransferRecord::new(
            FileTransferType::Download,
            FileTransferItemType::Remote,
            "report.pdf",
        );
        assert!(transfer.is_alive());
        transfer.mark_started();
        transfer.update_progress(5, 10);
        transfer.complete();
        assert_eq!(transfer.status, FileTransferStatus::Completed);
        assert_eq!(transfer.transferred_bytes, 10);
        assert!(!transfer.is_alive());
    }

    #[test]
    fn failed_transfers_are_retryable() {
        let mut transfer = FileTransferRecord::default();
        transfer.fail("network unavailable");
        assert_eq!(transfer.status, FileTransferStatus::Failed);
        assert!(transfer.retryable);
        assert!(!transfer.is_alive());
    }
}
