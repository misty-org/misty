export const agentDockMinWidth = 340;
export const agentDockMaxWidth = 620;

export interface AgentDockContext {
  surface: "files" | "space";
  label: string;
  spaceId?: string;
  spaceName?: string;
  section?: string;
  taskId?: string;
  cwd?: string | null;
  selectedPaths?: string[];
}

export function isCompactAgentDock(viewportWidth: number): boolean {
  return viewportWidth < 1100;
}

export function clampAgentDockWidth(width: number): number {
  return Math.min(agentDockMaxWidth, Math.max(agentDockMinWidth, width));
}

export function agentDockWidthStorageKey(accountId: string, spaceId: string): string {
  return `misty.agentDock.width.${accountId}.${spaceId}`;
}

export function agentDockSelectionStorageKey(accountId: string, scopeId: string): string {
  return `misty.agentDock.selection.${accountId}.${scopeId}`;
}

export function setAgentDockSearch(search: string, open: boolean): string {
  const params = new URLSearchParams(search);
  if (open) params.set("agentDock", "1");
  else params.delete("agentDock");
  return params.size ? `?${params.toString()}` : "";
}

export function filesAgentContextLabel(selectedCount: number): string {
  return selectedCount > 0 ? `Files · ${selectedCount} selected` : "Files";
}

export function agentServerSpaceSection(section?: string): string {
  if (section === "planner") return "tasks";
  if (section === "drawings") return "notes";
  return section || "agents";
}

export function agentTaskDockPath(spaceId: string, taskId: string, agentId: string): string {
  const query = new URLSearchParams({ task: taskId, agentDock: "1", agent: agentId });
  return `/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board?${query.toString()}`;
}

export function agentStarterPrompts(context: AgentDockContext, coordinator: boolean): string[] {
  if (context.surface === "files") {
    const selection = context.selectedPaths?.length
      ? `Review the ${context.selectedPaths.length} selected item${context.selectedPaths.length === 1 ? "" : "s"}.`
      : "What can you help me do in Files?";
    return [selection, "Explain which Files actions are unavailable here and why."];
  }
  if (coordinator) {
    return [
      "What needs my attention in this Space?",
      "Which Agent teammate is best suited for the work on this screen?",
    ];
  }
  return [
    `What can you do in ${context.spaceName || "this Space"}?`,
    "Show me the Planner work you can see and explain what you cannot change.",
  ];
}

export function resolveSelectedAgent<T extends { id: string }>(
  agents: readonly T[],
  selectedAgentId: string,
): T | null {
  const selected = agents.find((agent) => agent.id === selectedAgentId);
  if (selected) return selected;
  // A requested Agent can disappear briefly while its Space membership is
  // refreshing. Keep that selection unresolved instead of silently switching
  // the user back to Misty and overwriting the URL selection.
  return selectedAgentId ? null : (agents[0] ?? null);
}

export type AgentTaskDisplayState =
  "ready" | "working" | "needs_approval" | "failed" | "disabled" | "update_available" | "assigned";

export function agentTaskDisplayState(
  taskId: string,
  agent: { current_task_id?: string; work_state?: string },
): AgentTaskDisplayState {
  if (agent.current_task_id === taskId) {
    const state = agent.work_state ?? "assigned";
    if (
      [
        "ready",
        "working",
        "needs_approval",
        "failed",
        "disabled",
        "update_available",
        "assigned",
      ].includes(state)
    ) {
      return state as AgentTaskDisplayState;
    }
  }
  if (["ready", "disabled", "update_available"].includes(agent.work_state ?? "")) {
    return agent.work_state as AgentTaskDisplayState;
  }
  return "assigned";
}
