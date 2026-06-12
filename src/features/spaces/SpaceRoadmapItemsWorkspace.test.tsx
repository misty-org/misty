import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { roadmaps, roadmap, tasks } = vi.hoisted(() => ({
  roadmaps: vi.fn(),
  roadmap: vi.fn(),
  tasks: vi.fn(),
}));

vi.mock("@/api/spaces/api", () => ({
  spacesApi: { roadmaps, roadmap, tasks },
}));

import { SpaceRoadmapItemsWorkspace } from "@/features/spaces/roadmap/SpaceRoadmapItemsWorkspace";

describe("SpaceRoadmapItemsWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    roadmaps.mockResolvedValue({
      roadmaps: [{ id: "map-1", space_id: "space-1", name: "Beta launch" }],
    });
    roadmap.mockResolvedValue({
      roadmap: { id: "map-1", space_id: "space-1", name: "Beta launch", graph_version: 1 },
      goals: [
        {
          id: "goal-1",
          roadmap_id: "map-1",
          milestone_id: "milestone-1",
          title: "Ship onboarding",
          description: "",
          rank: 0,
          version: 1,
          task_total: 0,
          task_done: 0,
          progress_percentage: 40,
          status: "in_progress",
          tasks: [],
        },
      ],
      milestones: [
        {
          id: "milestone-1",
          roadmap_id: "map-1",
          title: "Beta ready",
          description: "",
          rank: 0,
          version: 1,
          goal_total: 1,
          goal_done: 0,
          status: "in_progress",
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
    tasks.mockResolvedValue({ tasks: [] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    ["goal", "Goals", "Ship onboarding"],
    ["milestone", "Milestones", "Beta ready"],
  ] as const)("lists collective %s configuration", async (kind, heading, item) => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SpaceRoadmapItemsWorkspace spaceId="space-1" kind={kind} canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(heading);
    expect(container.textContent).toContain(item);
    expect(container.textContent).toContain("Beta launch");
  });
});
