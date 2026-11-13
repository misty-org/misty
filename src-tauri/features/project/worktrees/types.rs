// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//! What the worktree commands take and return.

use super::*;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    /// The local branch checked out there; none when detached.
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    pub locked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lock_reason: Option<String>,
    /// Git says the worktree's folder is gone.
    pub prunable: bool,
    /// Files with uncommitted changes, for the removal warning. Not read for the main checkout.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed: Option<usize>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub samples: Vec<String>,
    /// Commits not pushed to the branch's upstream; none without one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
}

/// What the worktree menu and the create dialog need in one call.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListing {
    /// The repository's main checkout, which every worktree belongs to.
    pub repository: String,
    pub worktrees: Vec<WorktreeInfo>,
    pub branches: Vec<BranchInfo>,
    /// The branch the linked folder is on; `HEAD` when detached.
    pub current: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreateArgs {
    /// The Space the new worktree is linked to.
    pub space: String,
    pub branch: String,
    /// New-branch flow: where the branch starts (e.g. "origin/main").
    pub base_ref: Option<String>,
    /// Pull request flow: fetch `refs/pull/<n>/head` into `branch` first.
    pub pr_number: Option<u64>,
    /// Check out an existing local branch instead of making one.
    #[serde(default)]
    pub existing_branch: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProgress {
    pub creation_id: String,
    /// validate | fetch | add | register | done | failed | canceled
    pub stage: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The new worktree's folder, once it is linked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoveResult {
    /// Git had lost track of the folder, so Misty removed it itself.
    pub orphan_directory: bool,
    pub branch_deleted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_kept_reason: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPreview {
    pub number: u64,
    /// "owner/repo" on GitHub.
    pub repo: String,
    /// `gh` was missing or failed, so only the number is known.
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
    /// Where the worktree would go.
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
