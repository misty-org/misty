import { create } from "zustand";
import { multirunApi, type Multirun } from "./multirunApi";
import { rememberMultiruns } from "./multirunFolders";
import { draftLaneChats, resumeLanes, showLaneChats, startLane } from "./multirunRuns";

interface MultirunState {
  /** Each Space's multi-runs on this computer, newest first, once read. */
  runs: Record<string, Multirun[]>;
  load(space: string): Promise<Multirun[]>;
  /** Makes a worktree and a chat per agent, then starts every agent on the task at once. */
  start(space: string, folder: string, task: string, agentIds: string[]): Promise<Multirun>;
  /** Folds one lane's changes into the linked folder, staged for the person to review. */
  keep(space: string, multirun: string, lane: number): Promise<void>;
  /** Removes a multi-run's worktrees and branches. Its chats stay. */
  discard(space: string, multirun: string): Promise<void>;
}

export const useMultirunStore = create<MultirunState>((set, get) => {
  const put = (space: string, runs: Multirun[]) => {
    rememberMultiruns(runs);
    set({ runs: { ...get().runs, [space]: runs } });
    return runs;
  };
  return {
    runs: {},
    async load(space) {
      const runs = put(space, await multirunApi.list(space));
      void resumeLanes(runs);
      return runs;
    },
    async start(space, folder, task, agentIds) {
      const chats = draftLaneChats(task, agentIds);
      const run = await multirunApi.start(
        space,
        folder,
        task,
        chats.map((chat) => ({ agentId: chat.agentId ?? "", conversationId: chat.id })),
      );
      showLaneChats(chats);
      // The lanes' folders are known before their turns ask where to run.
      put(space, [run, ...(get().runs[space] ?? []).filter((item) => item.id !== run.id)]);
      for (const lane of run.lanes) void startLane(run, lane);
      return run;
    },
    async keep(space, multirun, lane) {
      await multirunApi.keep(multirun, lane);
      await get().load(space);
    },
    async discard(space, multirun) {
      await multirunApi.discard(multirun);
      put(
        space,
        (get().runs[space] ?? []).filter((item) => item.id !== multirun),
      );
    },
  };
});
