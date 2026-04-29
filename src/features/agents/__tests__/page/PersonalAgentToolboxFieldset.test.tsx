import type { AgentToolboxAction } from "@/services/spaces/dto/interfaces/agentArchitectureTypes";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalAgentToolboxFieldset } from "../../components/PersonalAgentToolboxFieldset";

describe("PersonalAgentToolboxFieldset", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("renders server-owned actions and emits an exact grant selection", async () => {
    const actions: AgentToolboxAction[] = [
      {
        name: "tasks.query",
        description: "Query visible Tasks.",
        risk: "read",
        approval: "none",
        locality: "server",
        idempotent: true,
        granted: true,
        available: true,
        reasons: [],
      },
      {
        name: "tasks.update",
        description: "Update an explicitly identified Task.",
        risk: "write",
        approval: "explicit_intent",
        locality: "server",
        idempotent: true,
        granted: false,
        available: false,
        reasons: [{ code: "grant_required", message: "Enable this action." }],
      },
    ];
    const onActionsChange = vi.fn();
    await act(async () => {
      root.render(
        <PersonalAgentToolboxFieldset
          actions={actions}
          activity={[
            {
              tool_name: "tasks.update",
              audit_event: "task.updated",
              risk: "write",
              source: "space_conversation",
              state: "completed",
              created_at: "2026-08-01T00:00:00Z",
              updated_at: "2026-08-01T00:00:01Z",
            },
          ]}
          loaded
          onActionsChange={onActionsChange}
        />,
      );
    });

    expect(container.textContent).toContain("Tasks · Update");
    expect(container.textContent).toContain("Approval: explicit request");
    expect(container.textContent).toContain("Recent action activity");
    const controls = container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(controls).toHaveLength(2);
    await act(async () => controls[1]?.click());
    expect(onActionsChange).toHaveBeenCalledWith([actions[0], { ...actions[1], granted: true }]);
  });
});
