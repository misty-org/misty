import {
  scheduledTasksApi,
  type ScheduledTask,
  type ScheduledTaskInput,
} from "@/api/scheduled/api";
import { create } from "zustand";

interface ScheduledTasksState {
  accountId: string;
  tasks: ScheduledTask[];
  state: "idle" | "loading" | "ready" | "error";
  error: string | null;
  setAccount(accountId: string): void;
  load(): Promise<void>;
  create(input: ScheduledTaskInput): Promise<ScheduledTask>;
  update(id: string, input: ScheduledTaskInput): Promise<ScheduledTask>;
  remove(id: string): Promise<void>;
  runNow(id: string): Promise<void>;
}

const sortTasks = (tasks: ScheduledTask[]) =>
  [...tasks].sort((left, right) => {
    const a = left.next_run_at ? Date.parse(left.next_run_at) : Number.POSITIVE_INFINITY;
    const b = right.next_run_at ? Date.parse(right.next_run_at) : Number.POSITIVE_INFINITY;
    return a - b || Date.parse(left.created_at) - Date.parse(right.created_at);
  });

/** The signed-in person's cloud scheduled tasks, shared by Home, the page, and Activity. */
export const useScheduledTasksStore = create<ScheduledTasksState>()((set, get) => {
  const replace = (task: ScheduledTask) =>
    set({ tasks: sortTasks([task, ...get().tasks.filter((item) => item.id !== task.id)]) });
  return {
    accountId: "",
    tasks: [],
    state: "idle",
    error: null,
    setAccount: (accountId) => {
      if (get().accountId === accountId) return;
      set({ accountId, tasks: [], state: "idle", error: null });
    },
    load: async () => {
      const accountId = get().accountId;
      if (!accountId) return;
      if (get().state !== "ready") set({ state: "loading" });
      try {
        const { tasks } = await scheduledTasksApi.list();
        if (get().accountId === accountId)
          set({ tasks: sortTasks(tasks), state: "ready", error: null });
      } catch (error) {
        if (get().accountId === accountId)
          set({ state: "error", error: error instanceof Error ? error.message : String(error) });
      }
    },
    create: async (input) => {
      const { task } = await scheduledTasksApi.create(input);
      replace(task);
      return task;
    },
    update: async (id, input) => {
      const { task } = await scheduledTasksApi.update(id, input);
      replace(task);
      return task;
    },
    remove: async (id) => {
      await scheduledTasksApi.remove(id);
      set({ tasks: get().tasks.filter((task) => task.id !== id) });
    },
    runNow: async (id) => {
      await scheduledTasksApi.runNow(id);
      const now = new Date().toISOString();
      set({
        tasks: sortTasks(
          get().tasks.map((task) => (task.id === id ? { ...task, next_run_at: now } : task)),
        ),
      });
    },
  };
});
