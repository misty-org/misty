import { describe, expect, it } from "vitest";
import {
  agentDockMaxWidth,
  agentDockMinWidth,
  agentDockSelectionStorageKey,
  agentDockWidthStorageKey,
  clampAgentDockWidth,
  agentTaskDisplayState,
  agentTaskDockPath,
  filesAgentContextLabel,
  isCompactAgentDock,
  resolveSelectedAgent,
  setAgentDockSearch,
} from "@/features/agents/agentDockState";

describe("Agent dock state", () => {
  it("preserves the current route query while opening and closing", () => {
    expect(setAgentDockSearch("?task=TASK-17&view=board", true)).toBe(
      "?task=TASK-17&view=board&agentDock=1",
    );
    expect(setAgentDockSearch("?task=TASK-17&agentDock=1", false)).toBe("?task=TASK-17");
  });

  it("isolates persisted widths by account and Space and clamps resizing", () => {
    expect(agentDockWidthStorageKey("account-a", "space-a")).not.toBe(
      agentDockWidthStorageKey("account-b", "space-a"),
    );
    expect(agentDockWidthStorageKey("account-a", "space-a")).not.toBe(
      agentDockWidthStorageKey("account-a", "space-b"),
    );
    expect(clampAgentDockWidth(100)).toBe(agentDockMinWidth);
    expect(clampAgentDockWidth(900)).toBe(agentDockMaxWidth);
  });

  it("isolates the remembered Agent by account and workspace scope", () => {
    expect(agentDockSelectionStorageKey("account-a", "space-a")).not.toBe(
      agentDockSelectionStorageKey("account-b", "space-a"),
    );
    expect(agentDockSelectionStorageKey("account-a", "space-a")).not.toBe(
      agentDockSelectionStorageKey("account-a", "files"),
    );
  });

  it("describes only the explicit Files selection", () => {
    expect(filesAgentContextLabel(0)).toBe("Files");
    expect(filesAgentContextLabel(2)).toBe("Files · 2 selected");
  });

  it("overlays compact desktops instead of shrinking the workspace", () => {
    expect(isCompactAgentDock(1099)).toBe(true);
    expect(isCompactAgentDock(1100)).toBe(false);
  });

  it("does not replace a requested Agent with Misty during a membership refresh", () => {
    const agents = [{ id: "misty" }, { id: "agent-a" }];
    expect(resolveSelectedAgent(agents, "agent-a")).toEqual({ id: "agent-a" });
    expect(resolveSelectedAgent([{ id: "misty" }], "agent-a")).toBeNull();
    expect(resolveSelectedAgent(agents, "")).toEqual({ id: "misty" });
  });

  it("attributes actionable Agent state only to the matching task", () => {
    const agent = { current_task_id: "task-a", work_state: "needs_approval" };
    expect(agentTaskDisplayState("task-a", agent)).toBe("needs_approval");
    expect(agentTaskDisplayState("task-b", agent)).toBe("assigned");
    expect(agentTaskDisplayState("task-b", { work_state: "disabled" })).toBe("disabled");
  });

  it("opens an assigned task without dropping the Agent dock selection", () => {
    expect(agentTaskDockPath("space/a", "task 17", "agent 2")).toBe(
      "/spaces/space%2Fa/planner/tasks/board?task=task+17&agentDock=1&agent=agent+2",
    );
  });
});
