// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! What the worktree commands take and return.

use super::*;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    pub locked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_reason: Option<String>,
    pub prunable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed: Option<usize>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub samples: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListing {
    pub repository: String,
    pub worktrees: Vec<WorktreeInfo>,
    pub branches: Vec<BranchInfo>,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreateArgs {
    pub space: String,
    pub branch: String,
    pub base_ref: Option<String>,
    pub pr_number: Option<u64>,
    #[serde(default)]
    pub existing_branch: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProgress {
    pub creation_id: String,
    pub stage: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoveResult {
    pub orphan_directory: bool,
    pub branch_deleted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_kept_reason: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPreview {
    pub number: u64,
    pub repo: String,
    pub degraded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additions: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deletions: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    pub branch_conflict: bool,
    pub dir_conflict: bool,
    pub path: String,
}

#[derive(Debug)]
pub(super) struct CreateFailure {
    pub(super) kind: &'static str,
    pub(super) message: String,
}

pub(super) fn fail(kind: &'static str, message: impl Into<String>) -> CreateFailure {
    CreateFailure {
        kind,
        message: message.into(),
    }
}
