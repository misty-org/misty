import { agentMethodsApi, type UpcomingWorkflowRun } from "@/api/ai/agent-methods";
import { create } from "zustand";

interface WorkflowSchedulesState {
  accountId: string;
  runs: UpcomingWorkflowRun[];
  state: "idle" | "loading" | "ready" | "error";
  setAccount(accountId: string): void;
  load(): Promise<void>;
}

/** Every agent's workflow schedules, soonest first, for Home and run notifications. */
export const useWorkflowSchedulesStore = create<WorkflowSchedulesState>()((set, get) => ({
  accountId: "",
  runs: [],
  state: "idle",
  setAccount: (accountId) => {
    if (get().accountId === accountId) return;
    set({ accountId, runs: [], state: "idle" });
  },
  load: async () => {
    const accountId = get().accountId;
    if (!accountId) return;
    if (get().state !== "ready") set({ state: "loading" });
    try {
      const { runs } = await agentMethodsApi.upcoming();
      if (get().accountId === accountId) set({ runs, state: "ready" });
    } catch {
      if (get().accountId === accountId) set({ state: "error" });
    }
  },
}));
