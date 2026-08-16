import { apiRequest } from "@/api/client";

export type ScheduledTaskCadence = "once" | "daily" | "weekdays" | "weekly" | "monthly";

/** When a task runs, in the owner's own timezone. */
export interface ScheduledTaskSchedule {
  cadence: ScheduledTaskCadence;
  /** 24-hour "HH:MM". */
  local_time: string;
  /** 0 = Sunday; used by weekly tasks. */
  weekday: number;
  /** 1–31; short months run on their last day. */
  month_day: number;
  /** "YYYY-MM-DD"; used by one-time tasks. */
  run_on?: string;
  timezone: string;
}

export interface ScheduledTask extends ScheduledTaskSchedule {
  id: string;
  conversation_id?: string;
  agent_id?: string;
  method_version_id?: string;
  method_inputs?: Record<string, string | number | boolean>;
  title: string;
  prompt: string;
  enabled: boolean;
  state: "idle" | "running" | "failed";
  next_run_at?: string;
  last_invocation_id?: string;
  last_run_at?: string;
  last_error?: string;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export type ScheduledTaskInput = Pick<
  ScheduledTask,
  "title" | "prompt" | "enabled" | "agent_id" | "method_version_id" | "method_inputs"
> &
  ScheduledTaskSchedule;

const base = "/ai/scheduled-tasks";

export const scheduledTasksApi = {
  list: () => apiRequest<{ tasks: ScheduledTask[] }>(base, { cache: "no-store" }),
  create: (input: ScheduledTaskInput) =>
    apiRequest<{ task: ScheduledTask }>(base, { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: ScheduledTaskInput) =>
    apiRequest<{ task: ScheduledTask }>(`${base}/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiRequest<void>(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }),
  runNow: (id: string) =>
    apiRequest<void>(`${base}/${encodeURIComponent(id)}/run`, { method: "POST" }),
};
