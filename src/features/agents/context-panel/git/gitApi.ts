// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";

export interface GitFileEntry {
  /** Relative to the repository, with `/` between names. */
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "typechange";
  additions?: number;
  deletions?: number;
}

export interface GitStatus {
  branch: string;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  /** Commits ahead of and behind the upstream; absent when the branch has none. */
  ahead?: number;
  behind?: number;
}

export interface BranchInfo {
  name: string;
  /** A remote-tracking branch (`origin/x`): switching to it makes the local branch. */
  isRemote: boolean;
}

/** Both sides of an image change as data URLs; a side is null when it doesn't exist. */
export interface GitImageDiff {
  old: string | null;
  new: string | null;
}

/** An issue the branch's pull request closes. Title and state are absent when `gh` couldn't say. */
export interface LinkedIssue {
  number: number;
  title?: string;
  state?: "OPEN" | "CLOSED";
  url?: string;
}

/** The pull request for the branch checked out in a folder, as the GitHub CLI reports it. */
export interface BranchPullRequest {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  url: string;
  draft: boolean;
  /** How its checks stand together; absent when it has none. */
  checks?: "passing" | "failing" | "pending";
  issues: LinkedIssue[];
}

const account = () => agentAccountId();

/** The changes panel's native calls (`project/git.rs`). Every folder is checked against the account's linked folders. */
export const gitApi = {
  status: (folder: string) =>
    invoke<GitStatus>("project_git_status", { account: account(), folder }),
  diff: (folder: string, file: string, staged: boolean) =>
    invoke<string>("project_git_diff", { account: account(), folder, file, staged }),
  diffImages: (folder: string, file: string, staged: boolean) =>
    invoke<GitImageDiff>("project_git_diff_images", { account: account(), folder, file, staged }),
  stage: (folder: string, files: string[]) =>
    invoke<void>("project_git_stage", { account: account(), folder, files }),
  unstage: (folder: string, files: string[]) =>
    invoke<void>("project_git_unstage", { account: account(), folder, files }),
  discard: (folder: string, files: string[]) =>
    invoke<void>("project_git_discard", { account: account(), folder, files }),
  commit: (folder: string, message: string) =>
    invoke<string>("project_git_commit", { account: account(), folder, message }),
  push: (folder: string) => invoke<void>("project_git_push", { account: account(), folder }),
  pull: (folder: string) => invoke<void>("project_git_pull", { account: account(), folder }),
  branches: (folder: string) =>
    invoke<BranchInfo[]>("project_git_branches", { account: account(), folder }),
  checkout: (folder: string, branch: string) =>
    invoke<void>("project_git_checkout", { account: account(), folder, branch }),
  createBranch: (folder: string, name: string) =>
    invoke<void>("project_git_create_branch", { account: account(), folder, name }),
  init: (folder: string) => invoke<void>("project_git_init", { account: account(), folder }),
  /** The checked-out branch's pull request; null without one, or without a working `gh`. */
  pullRequest: (folder: string) =>
    invoke<BranchPullRequest | null>("project_branch_pull_request", { account: account(), folder }),
};

const rawText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export const isNotARepo = (reason: unknown) => rawText(reason).includes("NOT_A_REPO");

/** A Git failure in words a person can act on: the native side tags why a repository wouldn't open. */
export function gitErrorText(reason: unknown): string {
  const text = rawText(reason);
  const unsafe = /GIT_UNSAFE_REPO:(.*)/s.exec(text);
  if (unsafe) {
    return (
      `Git doesn't trust who owns this repository (${unsafe[1].trim()}). Add it to ` +
      "safe.directory with git config --global --add safe.directory <path>, or open it as its owner."
    );
  }
  const failed = /GIT_OPEN_FAILED:(.*)/s.exec(text);
  if (failed) return `The repository couldn't be opened: ${failed[1].trim()}`;
  if (text.includes("NOT_A_REPO")) return "This folder isn't a Git repository.";
  return text;
}

/** Mirrors `is_image` in `project/git/repo.rs`, which serves both sides of the image. */
export const IMAGE_FILE_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico)$/i;
