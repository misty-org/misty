import { invoke } from "@/native/invoke";
import { agentAccountId } from "../personal/agent_account";

export interface MultirunLane {
  index: number;
  agentId: string;
  conversationId: string;
  folder: string;
  branch: string;
  kept: boolean;
}

export interface Multirun {
  id: string;
  task: string;
  folder: string;
  createdAt: number;
  lanes: MultirunLane[];
}

export interface LaneFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  insertions: number;
  deletions: number;
  patch: string;
}

export type Readiness = "ready" | "no_git" | "not_repository" | "not_top_level" | "no_commits";

const account = () => agentAccountId();

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
