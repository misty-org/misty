// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agent_account";

export interface GitFileEntry {
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
  ahead?: number;
  behind?: number;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
}

export interface GitImageDiff {
  old: string | null;
  new: string | null;
}

export interface LinkedIssue {
  number: number;
  title?: string;
  state?: "OPEN" | "CLOSED";
  url?: string;
}

export interface BranchPullRequest {
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  url: string;
  draft: boolean;
  checks?: "passing" | "failing" | "pending";
  issues: LinkedIssue[];
}

const account = () => agentAccountId();

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
  pullRequest: (folder: string) =>
    invoke<BranchPullRequest | null>("project_branch_pull_request", { account: account(), folder }),
};

const rawText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

export const isNotARepo = (reason: unknown) => rawText(reason).includes("NOT_A_REPO");

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

export const IMAGE_FILE_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico)$/i;
