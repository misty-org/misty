import { invoke } from "@/native/invoke";
import { agentAccountId } from "../personal/agentAccount";

export interface ProjectEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  /** A folder the tree shows but doesn't open by itself (`.git`, `node_modules`). */
  heavy: boolean;
}

export interface ProjectFile {
  kind: "text" | "binary";
  text: string;
  /** Longer than what was read: it opens read-only, since saving would cut it short. */
  truncated: boolean;
}

export interface GitChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
}

export interface GitStatus {
  repository: boolean;
  branch: string;
  changes: GitChange[];
}

const account = () => agentAccountId();

/** The panels' native calls. Each path is checked natively against the account's linked folders. */
export const projectApi = {
  listDir: (path: string) =>
    invoke<ProjectEntry[]>("project_list_dir", { account: account(), path }),
  readFile: (path: string) =>
    invoke<ProjectFile>("project_read_file", { account: account(), path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("project_write_file", { account: account(), path, content }),
  gitStatus: (folder: string) =>
    invoke<GitStatus>("project_git_status", { account: account(), folder }),
  gitDiff: (folder: string, change: GitChange) =>
    invoke<string>("project_git_diff", {
      account: account(),
      folder,
      file: change.path,
      staged: change.staged,
      untracked: change.status === "untracked",
    }),
  gitStage: (folder: string, files: string[], stage: boolean) =>
    invoke<void>("project_git_stage", { account: account(), folder, files, stage }),
  gitCommit: (folder: string, message: string) =>
    invoke<void>("project_git_commit", { account: account(), folder, message }),
  terminalOpen: (id: string, folder: string, cols: number, rows: number) =>
    invoke<void>("project_terminal_open", { account: account(), id, folder, cols, rows }),
  terminalWrite: (id: string, data: string) => invoke<void>("project_terminal_write", { id, data }),
  terminalResize: (id: string, cols: number, rows: number) =>
    invoke<void>("project_terminal_resize", { id, cols, rows }),
  terminalClose: (id: string) => invoke<void>("project_terminal_close", { id }),
};

export const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
