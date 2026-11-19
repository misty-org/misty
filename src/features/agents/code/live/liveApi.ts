import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";
import type { LiveRepo } from "./liveTypes";

/** Outside edits in a session worktree, sent to the window that watches it. */
export const FILE_CHANGED_EVENT = "misty://code-live-file-changed";

export interface PlannedFile {
  path: string;
  /** The whole text in this commit; null removes the file. */
  text: string | null;
}

export interface PlannedCommit {
  message: string;
  /** Who wrote it; the committer's own Git identity when unknown. */
  author: { name: string; email: string } | null;
  files: PlannedFile[];
}

export type MergeOutcome =
  | { status: "merged"; head: string }
  | { status: "conflicts"; files: Array<{ path: string; text: string }> };

const account = () => agentAccountId();

/** Live sessions' native calls (`code/live`). Every folder is checked against the linked ones. */
export const liveApi = {
  repo: (folder: string, baseCommit: string | null, fetch: boolean) =>
    invoke<LiveRepo>("code_live_repo", { account: account(), folder, baseCommit, fetch }),
  createWorktree: (folder: string, space: string, branch: string, baseCommit: string) =>
    invoke<string>("code_live_worktree_create", {
      account: account(),
      folder,
      space,
      branch,
      baseCommit,
    }),
  removeWorktree: (folder: string, space: string, worktree: string, deleteBranch: boolean) =>
    invoke<void>("code_live_worktree_remove", {
      account: account(),
      folder,
      space,
      worktree,
      deleteBranch,
    }),
  /** A file at the base commit; null when it didn't exist then. */
  baseFile: (folder: string, baseCommit: string, path: string) =>
    invoke<string | null>("code_live_base_file", { account: account(), folder, baseCommit, path }),
  /** Writes the shared text; returns the file's text instead when it changed outside Misty. */
  write: (folder: string, path: string, text: string) =>
    invoke<string | null>("code_live_write", { account: account(), folder, path, text }),
  watch: (folder: string, paths: string[]) =>
    invoke<void>("code_live_watch", { account: account(), folder, paths }),
  unwatch: (folder: string) => invoke<void>("code_live_unwatch", { account: account(), folder }),
  reset: (folder: string, baseCommit: string) =>
    invoke<void>("code_live_reset", { account: account(), folder, baseCommit }),
  commit: (folder: string, baseCommit: string, commits: PlannedCommit[]) =>
    invoke<string[]>("code_live_commit", { account: account(), folder, baseCommit, commits }),
  merge: (folder: string, defaultBranch: string, resolved: PlannedFile[]) =>
    invoke<MergeOutcome>("code_live_merge", {
      account: account(),
      folder,
      defaultBranch,
      resolved,
    }),
  /** Why the session can't land on main in this checkout; null when it can. */
  landCheck: (folder: string, defaultBranch: string) =>
    invoke<string | null>("code_live_land_check", { account: account(), folder, defaultBranch }),
  land: (folder: string, branch: string, defaultBranch: string) =>
    invoke<void>("code_live_land", { account: account(), folder, branch, defaultBranch }),
  push: (folder: string) => invoke<void>("code_live_push", { account: account(), folder }),
  openPullRequest: (folder: string, base: string, title: string, body: string) =>
    invoke<{ url: string; created: boolean }>("code_live_open_pr", {
      account: account(),
      folder,
      base,
      title,
      body,
    }),
};

/** A native or server failure in a person's words. */
export function liveErrorText(reason: unknown): string {
  const code = (reason as { code?: unknown } | null)?.code;
  if (code === "branch_in_use") return "Someone already started a live session on this branch.";
  if (code === "session_ended") return "This live session has ended.";
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "Something went wrong. Try again.";
}
