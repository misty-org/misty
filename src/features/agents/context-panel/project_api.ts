import { invoke } from "@/native/invoke";
import { agentAccountId } from "../personal/agent_account";
import { gitApi, isNotARepo, type GitFileEntry } from "./git/git_api";

interface ProjectEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  heavy: boolean;
}

interface ProjectFile {
  kind: "text" | "binary";
  text: string;
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

const summaryOf = (entry: GitFileEntry): Omit<GitChange, "staged"> => ({
  path: entry.path,
  status: entry.status === "typechange" ? "modified" : entry.status,
});

export const projectApi = {
  listDir: (path: string) =>
    invoke<ProjectEntry[]>("project_list_dir", { account: account(), path }),
  readFile: (path: string) =>
    invoke<ProjectFile>("project_read_file", { account: account(), path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("project_write_file", { account: account(), path, content }),
  gitStatus: async (folder: string): Promise<GitStatus> => {
    try {
      const status = await gitApi.status(folder);
      const changes: GitChange[] = [
        ...status.staged.map((entry) => ({ ...summaryOf(entry), staged: true })),
        ...status.unstaged.map((entry) => ({ ...summaryOf(entry), staged: false })),
        ...status.untracked.map((entry) => ({
          path: entry.path,
          status: "untracked" as const,
          staged: false,
        })),
      ];
      return { repository: true, branch: status.branch, changes };
    } catch (reason) {
      if (isNotARepo(reason)) return { repository: false, branch: "", changes: [] };
      throw reason;
    }
  },
};

export const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
