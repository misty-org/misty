import { invoke } from "@/native/invoke";
import { agentAccountId } from "../personal/agentAccount";

/** One agent's part of a multi-run: its own worktree of the folder, and the chat its turn runs in. */
export interface MultirunLane {
  index: number;
  agentId: string;
  conversationId: string;
  /** The worktree. Native code made it and accepts it as the folder of this lane's chat turns. */
  folder: string;
  branch: string;
  kept: boolean;
}

/** One task given to several agents at once, each working in its own copy of the linked folder. */
export interface Multirun {
  id: string;
  task: string;
  /** The linked folder the lanes were made from. */
  folder: string;
  createdAt: number;
  lanes: MultirunLane[];
}

/** One file a lane changed since the multi-run started, with its unified diff. */
export interface LaneFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  insertions: number;
  deletions: number;
  patch: string;
}

/** Whether a folder can take a multi-run, or the one thing in the way. */
export type Readiness = "ready" | "no_git" | "not_repository" | "not_top_level" | "no_commits";

const account = () => agentAccountId();

/** Multi-run's native calls. Folders and branches are made and named natively, never here. */
export const multirunApi = {
  check: (folder: string) => invoke<Readiness>("multirun_check", { account: account(), folder }),
  start: (
    space: string,
    folder: string,
    task: string,
    lanes: { agentId: string; conversationId: string }[],
  ) => invoke<Multirun>("multirun_start", { account: account(), space, folder, task, lanes }),
  list: (space: string) => invoke<Multirun[]>("multirun_list", { account: account(), space }),
  changes: (multirun: string, lane: number) =>
    invoke<LaneFile[]>("multirun_changes", { account: account(), multirun, lane }),
  keep: (multirun: string, lane: number) =>
    invoke<void>("multirun_keep", { account: account(), multirun, lane }),
  discard: (multirun: string) => invoke<void>("multirun_discard", { account: account(), multirun }),
};

export const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
