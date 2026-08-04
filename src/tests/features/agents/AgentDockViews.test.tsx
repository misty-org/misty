import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentAboutView, AgentWorkView } from "@/features/agents/AgentDockViews";
import type {
  SpaceRun,
  SpaceRunDetail,
} from "@/models/interfaces/features/spaces/agentArchitectureTypes";

const misty = {
  id: "misty",
  name: "Misty",
  role: "Team coordinator",
  description: "Routes work to the right teammate.",
  icon: "sparkles",
  coordinator: true,
};

describe("Agent About manual", () => {
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

  it("renders canonical availability and precise denial reasons", async () => {
    await act(async () => {
      root.render(
        <AgentAboutView
          agent={misty}
          toolbox={[
            {
              name: "agents.delegate",
              description: "Delegate work to an installed Agent.",
              risk: "write",
              approval: "explicit_intent",
              locality: "server",
              idempotent: false,
              granted: true,
              available: false,
              reasons: [
                {
                  code: "member_permission_required",
                  message: "Your Space role does not allow this action.",
                },
              ],
            },
          ]}
          availableContext={["Current Space", "Planner tasks and task notes"]}
          loading={false}
          starterPrompts={["What needs my attention in this Space?"]}
          onUseStarter={vi.fn()}
          onCreateAgent={vi.fn()}
          onManageAgents={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Agents · Delegate");
    expect(container.textContent).toContain("Your Space role does not allow this action.");
    expect(container.textContent).toContain("Planner tasks and task notes");
  });

  it("shows denied actions even when the Agent has no granted actions", async () => {
    await act(async () => {
      root.render(
        <AgentAboutView
          agent={misty}
          toolbox={[
            {
              name: "tasks.update",
              description: "Update Planner tasks.",
              risk: "write",
              approval: "explicit_intent",
              locality: "server",
              idempotent: true,
              granted: false,
              available: false,
              reasons: [
                { code: "grant_required", message: "This action is not granted to the Agent." },
              ],
            },
          ]}
          availableContext={[]}
          loading={false}
          starterPrompts={[]}
          onUseStarter={vi.fn()}
          onCreateAgent={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Tasks · Update");
    expect(container.textContent).toContain("This action is not granted to the Agent.");
  });

  it("moves starter prompts into Chat and exposes creation and management actions", async () => {
    const onUseStarter = vi.fn();
    const onCreateAgent = vi.fn();
    const onManageAgents = vi.fn();
    await act(async () => {
      root.render(
        <AgentAboutView
          agent={misty}
          toolbox={[]}
          availableContext={[]}
          loading={false}
          starterPrompts={["What needs my attention in this Space?"]}
          onUseStarter={onUseStarter}
          onCreateAgent={onCreateAgent}
          onManageAgents={onManageAgents}
        />,
      );
    });

    await clickButton(container, "What needs my attention in this Space?");
    await clickButton(container, "Create Agent");
    await clickButton(container, "Manage Agents");
    expect(onUseStarter).toHaveBeenCalledWith("What needs my attention in this Space?");
    expect(onCreateAgent).toHaveBeenCalledOnce();
    expect(onManageAgents).toHaveBeenCalledOnce();
  });
});

describe("Agent Work receipts", () => {
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

  it("shows an assigned task, result, and actionable approval", async () => {
    const onDecide = vi.fn();
    const onOpenTask = vi.fn();
    const run = {
      id: "run-1",
      state: "awaiting_approval",
      trigger_kind: "task_assignment",
      source_task_id: "task-17",
      progress: 75,
      result: { summary: "Drafted the family plan." },
      outputs: {},
      created_at: "2026-08-02T00:00:00Z",
      updated_at: "2026-08-02T00:01:00Z",
    } as unknown as SpaceRun;
    const detail = {
      run,
      actions: [],
      steps: [],
      approvals: [
        {
          id: "approval-1",
          run_id: run.id,
          requested_from_user_id: "user-1",
          action_summary: "Move TASK-17 to Done",
          proposed_actions: [],
          state: "pending",
          created_at: run.created_at,
          expires_at: "2026-08-03T00:00:00Z",
        },
      ],
    } satisfies SpaceRunDetail;

    await act(async () => {
      root.render(
        <AgentWorkView
          agent={misty}
          runs={[run]}
          conversations={[]}
          running
          loading={false}
          details={{ [run.id]: detail }}
          onDecide={onDecide}
          onRetry={vi.fn()}
          onCancel={vi.fn()}
          onOpenTask={onOpenTask}
        />,
      );
    });

    expect(container.textContent).toContain("Move TASK-17 to Done");
    expect(container.textContent).toContain("Drafted the family plan.");
    await clickButton(container, "Approve");
    await clickButton(container, "Open assigned task");
    expect(onDecide).toHaveBeenCalledWith("run-1", true);
    expect(onOpenTask).toHaveBeenCalledWith("task-17");
  });
});

async function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
