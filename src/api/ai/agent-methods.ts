import { apiRequest } from "@/api/client";

export type AgentMethodKind = "workflow" | "template" | "skill";
export type AgentMethodInputs = Record<string, string | number | boolean>;
export interface AgentMethodInput {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "choice";
  required: boolean;
  options?: string[];
}
export interface AgentMethodDefinition {
  title: string;
  description: string;
  instructions: string;
  inputs: AgentMethodInput[];
  target: "cloud" | "separate_window" | "current_window";
  required_tools: string[];
}
export type ScheduleFrequency = "once" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
/** "The second Tuesday" is { nth: 2, weekday: 2 }; "the last Friday" is { nth: -1, weekday: 5 }. */
export interface NthWeekday {
  nth: number;
  weekday: number;
}
/** One repeating pattern. Weekdays are 0–6 from Sunday; month day -1 is the last day. */
export interface ScheduleRule {
  frequency: ScheduleFrequency;
  interval?: number;
  /** once: YYYY-MM-DD. */
  dates?: string[];
  /** 24-hour HH:MM; every frequency except hourly. */
  times?: string[];
  /** hourly: minute past each hour, optionally only between from and until. */
  minute?: number;
  from?: string;
  until?: string;
  weekdays?: number[];
  month_days?: number[];
  nth_weekdays?: NthWeekday[];
  months?: number[];
  start_date?: string;
  end_date?: string;
}
/** When a workflow runs: any number of rules in one timezone, minus skipped dates. */
export interface ScheduleTiming {
  timezone: string;
  rules: ScheduleRule[];
  skip_dates: string[];
}
export interface WorkflowSchedule extends ScheduleTiming {
  id: string;
  method_id: string;
  conversation_id?: string;
  inputs: AgentMethodInputs;
  enabled: boolean;
  state: "idle" | "running" | "failed";
  next_run_at?: string;
  last_invocation_id?: string;
  last_run_at?: string;
  last_error?: string;
  run_count: number;
}
export interface UpcomingWorkflowRun extends WorkflowSchedule {
  title: string;
  agent_id: string;
}
export interface AgentMethod {
  id: string;
  agent_id: string;
  kind: AgentMethodKind;
  enabled: boolean;
  version_id: string;
  version: number;
  definition: AgentMethodDefinition;
  source_invocation_id?: string;
  updated_at: string;
  /** When a workflow runs on its own; absent runs only when started. */
  schedule?: WorkflowSchedule;
}
export interface SaveAgentMethod {
  id?: string;
  agent_id: string;
  kind: AgentMethodKind;
  enabled: boolean;
  expected_version?: number;
  source_invocation_id?: string;
  definition: AgentMethodDefinition;
}
const base = "/ai/agent-methods";
export const agentMethodsApi = {
  list: (agentId: string) =>
    apiRequest<{ methods: AgentMethod[] }>(`${base}?agent_id=${encodeURIComponent(agentId)}`, {
      cache: "no-store",
    }),
  save: (input: SaveAgentMethod) =>
    apiRequest<{ method: AgentMethod }>(
      input.id ? `${base}/${encodeURIComponent(input.id)}` : base,
      { method: input.id ? "PUT" : "POST", body: JSON.stringify(input) },
    ),
  /** Sets a workflow's schedule; every run uses the workflow's latest version. */
  saveSchedule: (
    methodId: string,
    schedule: ScheduleTiming & { inputs: AgentMethodInputs; enabled: boolean },
  ) =>
    apiRequest<{ schedule: WorkflowSchedule }>(`${base}/${encodeURIComponent(methodId)}/schedule`, {
      method: "PUT",
      body: JSON.stringify(schedule),
    }),
  removeSchedule: (methodId: string) =>
    apiRequest<void>(`${base}/${encodeURIComponent(methodId)}/schedule`, { method: "DELETE" }),
  upcoming: () =>
    apiRequest<{ runs: UpcomingWorkflowRun[] }>("/ai/workflow-schedules", { cache: "no-store" }),
  instantiate: (versionId: string, inputs: AgentMethodInputs) =>
    apiRequest<{ prompt: string; method: AgentMethod }>(`${base}/instantiate`, {
      method: "POST",
      body: JSON.stringify({ version_id: versionId, inputs }),
    }),
};
