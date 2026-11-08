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
  /** Older methods may still hold "separate_window"; it runs as "current_window". */
  target: "cloud" | "current_window";
  required_tools: string[];
}
export type ScheduleFrequency = "once" | "hourly" | "daily" | "weekly" | "monthly" | "yearly";
/** "The second Tuesday" is { nth: 2, weekday: 2 }; "the last Friday" is { nth: -1, weekday: 5 }. */
interface NthWeekday {
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
  /**
   * awaiting_device: due, waiting for Misty on its computer (device_claimed: starting there).
   * handed_off: kept on this computer, due and waiting for a window of its profile.
   */
  state: "idle" | "running" | "failed" | "awaiting_device" | "device_claimed" | "handed_off";
  /** The computer whose Misty browser runs it; absent runs without a browser. */
  device_id?: string;
  /** The profile whose sign-ins runs use, chosen when the schedule is made. */
  profile: string;
  /** The run waiting for its computer, and later runs that passed meanwhile. */
  due_at?: string;
  missed_count?: number;
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
  /** The Space whose memory holds it; empty is the personal Space. */
  space_id?: string;
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
export type SaveWorkflowSchedule = ScheduleTiming & {
  inputs: AgentMethodInputs;
  enabled: boolean;
  /** "" runs without a browser; absent keeps the current computer. */
  device_id?: string;
  profile?: string;
};
/** Workflows kept on this computer, in misty.db. */
const local = () =>
  import("@/features/agents/workflows/localAgentMethods").then(
    (module) => module.localAgentMethods,
  );
export const agentMethodsApi = {
  list: (agentId: string, _onCached?: (value: { methods: AgentMethod[] }) => void) =>
    local().then((methods) => methods.list(agentId)),
  save: (input: SaveAgentMethod) => local().then((methods) => methods.save(input)),
  /** Sets a workflow's schedule; every run uses the workflow's latest version. */
  saveSchedule: (methodId: string, schedule: SaveWorkflowSchedule) =>
    local().then((methods) => methods.saveSchedule(methodId, schedule)),
  removeSchedule: (methodId: string) => local().then((methods) => methods.removeSchedule(methodId)),
  upcoming: () => local().then((methods) => methods.upcoming()),
  instantiate: (versionId: string, inputs: AgentMethodInputs) =>
    local().then((methods) => methods.instantiate(versionId, inputs)),
};
