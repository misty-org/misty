// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";

export interface WorktreeInfo {
  path: string;
  /** The local branch checked out there; absent when detached. */
  branch: string | null;
  head: string;
  isMain: boolean;
  locked: boolean;
  lockReason?: string;
  /** Git says the worktree's folder is gone. */
  prunable: boolean;
  /** Files with uncommitted changes; not read for the main checkout. */
  changed?: number;
  samples?: string[];
  /** Commits not pushed to the branch's upstream; absent without one. */
  ahead?: number;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
}

export interface WorktreeListing {
  /** The repository's main checkout. */
  repository: string;
  worktrees: WorktreeInfo[];
  branches: BranchInfo[];
  /** The linked folder's branch; `HEAD` when detached. */
  current: string | null;
}

export interface WorktreeCreateArgs {
  /** The Space the new worktree is linked to. */
  space: string;
  branch: string;
  /** New-branch flow: where it starts. */
  baseRef: string | null;
  /** Pull request flow: fetch `refs/pull/<n>/head` into `branch` first. */
  prNumber: number | null;
  existingBranch: boolean;
}

export type WorktreeCreateStage =
  "validate" | "fetch" | "add" | "register" | "done" | "failed" | "canceled";

export type WorktreeErrorKind =
  | "pr_not_found"
  | "fetch_failed"
  | "branch_exists"
  | "dir_exists"
  | "branch_checked_out"
  | "branch_not_found"
  | "base_not_found"
  | "not_a_repo"
  | "repo_open_failed"
  | "invalid_branch"
  | "invalid_args"
  | "add_failed"
  | "register_failed"
  | "sparse_checkout_empty"
  | "unknown";

export interface WorktreeCreateProgress {
  creationId: string;
  stage: WorktreeCreateStage;
  message?: string;
  errorKind?: WorktreeErrorKind;
  error?: string;
  /** The new worktree's folder, on `done`. */
  path?: string;
}

interface WorktreeRemoveResult {
  orphanDirectory: boolean;
  branchDeleted: boolean;
  branchKeptReason?: "checked_out_elsewhere" | "unknown";
}

export interface PrPreview {
  number: number;
  repo: string;
  /** `gh` was missing or failed: only the number is known. */
  degraded: boolean;
  title?: string;
  author?: string;
  additions?: number;
  deletions?: number;
  state?: string;
  branchConflict: boolean;
  dirConflict: boolean;
  /** Where the worktree would go. */
  path: string;
}

export const WORKTREE_PROGRESS_EVENT = "misty://worktree-progress";

const account = () => agentAccountId();

/** The worktree commands (`project/worktrees.rs`). Each folder is checked against the account's links. */
export const worktreeApi = {
  list: (folder: string) =>
    invoke<WorktreeListing>("project_worktree_list", { account: account(), folder }),
  create: (folder: string, creationId: string, args: WorktreeCreateArgs) =>
    invoke<void>("project_worktree_create", { account: account(), folder, creationId, args }),
  cancel: (creationId: string) => invoke<boolean>("project_worktree_create_cancel", { creationId }),
  remove: (folder: string, space: string, worktree: string, deleteBranch: boolean) =>
    invoke<WorktreeRemoveResult>("project_worktree_remove", {
      account: account(),
      folder,
      space,
      worktree,
      deleteBranch,
    }),
  branchMerged: (folder: string, branch: string, base: string) =>
    invoke<boolean>("project_worktree_branch_merged", {
      account: account(),
      folder,
      branch,
      base,
    }),
  resolvePr: (folder: string, input: string, suggestedBranch: string) =>
    invoke<PrPreview>("project_worktree_resolve_pr", {
      account: account(),
      folder,
      input,
      suggestedBranch,
    }),
};
