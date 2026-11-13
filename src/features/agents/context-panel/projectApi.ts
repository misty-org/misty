import { invoke } from "@/native/invoke";
import { agentAccountId } from "../personal/agentAccount";
import { gitApi, isNotARepo, type GitFileEntry } from "./git/gitApi";

interface ProjectEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  /** A folder the tree shows but doesn't open by itself (`.git`, `node_modules`). */
  heavy: boolean;
}

interface ProjectFile {
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

const summaryOf = (entry: GitFileEntry): Omit<GitChange, "staged"> => ({
  path: entry.path,
  status: entry.status === "typechange" ? "modified" : entry.status,
});

/** The panels' native calls. Each path is checked natively against the account's linked folders. */
export const projectApi = {
  listDir: (path: string) =>
    invoke<ProjectEntry[]>("project_list_dir", { account: account(), path }),
  readFile: (path: string) =>
    invoke<ProjectFile>("project_read_file", { account: account(), path }),
  writeFile: (path: string, content: string) =>
    invoke<void>("project_write_file", { account: account(), path, content }),
  /** A short read of the folder's Git state for the session card and Space home: the branch and
   * every changed file. The changes panel itself reads the full status (`git/gitApi.ts`). */
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
