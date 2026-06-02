import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { roadmaps, roadmap, tasks, createRoadmap } = vi.hoisted(() => ({
  roadmaps: vi.fn(),
  roadmap: vi.fn(),
  tasks: vi.fn(),
  createRoadmap: vi.fn(),
}));

vi.mock("@/api/spaces/api", () => ({
  SpaceRequestError: class SpaceRequestError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  spacesApi: { roadmaps, roadmap, tasks, createRoadmap },
}));

import { SpaceRoadmapWorkspace } from "@/features/spaces/roadmap/SpaceRoadmapWorkspace";

describe("SpaceRoadmapWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    roadmaps.mockResolvedValue({
      roadmaps: [
        {
          id: "map-1",
          space_id: "space-1",
          name: "Launch plan",
          description: "Beta launch",
          graph_version: 1,
        },
      ],
    });
    tasks.mockResolvedValue({ tasks: [] });
    roadmap.mockResolvedValue({
      roadmap: {
        id: "map-1",
        space_id: "space-1",
        name: "Launch plan",
        description: "Beta launch",
        graph_version: 1,
        updated_at: "2026-08-29T00:00:00Z",
      },
      milestones: [
        {
          id: "milestone-1",
          title: "Beta ready",
          rank: 1,
          goal_total: 1,
          goal_done: 0,
          status: "in_progress",
        },
      ],
      goals: [
        {
          id: "goal-1",
          milestone_id: "milestone-1",
          title: "Complete onboarding",
          rank: 1,
          task_total: 3,
          progress_percentage: 40,
          status: "in_progress",
          tasks: [],
        },
      ],
      nodes: [],
      node_definitions: [],
      edges: [],
      goal_total: 1,
      goal_done: 0,
      milestone_total: 1,
      milestone_done: 0,
      progress_percentage: 40,
    });
    createRoadmap.mockResolvedValue({
      roadmap: { id: "map-2" },
      milestones: [],
      goals: [],
      edges: [],
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("lists multiple roadmap entry points", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/roadmaps"]}>
          <SpaceRoadmapWorkspace spaceId="space-1" roadmapId="" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Roadmaps");
    expect(container.textContent).toContain("Launch plan");
    expect(container.textContent).toContain("New");
    expect(container.textContent).toContain("Beta ready");
    expect(container.textContent).toContain("Complete onboarding");
    expect(container.textContent).not.toContain("MilestonesGoals");
    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Launch plan"]',
    );
    expect(openButton?.dataset.variant).toBe("default");
    expect(openButton?.querySelector('[data-icon="inline-end"]')).not.toBeNull();
  });

  it("creates an untitled roadmap from New", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/roadmaps"]}>
          <SpaceRoadmapWorkspace spaceId="space-1" roadmapId="" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const newButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "New",
    );
    await act(async () => {
      newButton?.click();
      await Promise.resolve();
    });

    expect(createRoadmap).toHaveBeenCalledWith("space-1", "Untitled roadmap");
  });

  it("creates an untitled roadmap from the empty state", async () => {
    roadmaps.mockResolvedValueOnce({ roadmaps: [] });
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/roadmaps"]}>
          <SpaceRoadmapWorkspace spaceId="space-1" roadmapId="" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const emptyStateButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Create roadmap",
    );
    await act(async () => {
      emptyStateButton?.click();
      await Promise.resolve();
    });

    expect(createRoadmap).toHaveBeenCalledWith("space-1", "Untitled roadmap");
  });

  it("hides creation controls without tasks.manage", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/roadmaps"]}>
          <SpaceRoadmapWorkspace spaceId="space-1" roadmapId="" canManage={false} />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Launch plan");
    expect(container.textContent).not.toContain("Create roadmap");
  });
});
