export type AgentTaskDisplayState =
  | "ready"
  | "queued"
  | "working"
  | "awaiting_approval"
  | "needs_approval"
  | "retrying"
  | "failed"
  | "disabled"
  | "update_available"
  | "assigned";

export function agentTaskDisplayState(
  taskId: string,
  agent: { current_task_id?: string; work_state?: string },
): AgentTaskDisplayState {
  const visibleStates: AgentTaskDisplayState[] = [
    "ready",
    "queued",
    "working",
    "awaiting_approval",
    "needs_approval",
    "retrying",
    "failed",
    "disabled",
    "update_available",
    "assigned",
  ];
  if (agent.current_task_id === taskId) {
    const state = (agent.work_state ?? "assigned") as AgentTaskDisplayState;
    if (visibleStates.includes(state)) return state;
  }
  if (["ready", "disabled", "update_available"].includes(agent.work_state ?? "")) {
    return agent.work_state as AgentTaskDisplayState;
  }
  return "assigned";
}
