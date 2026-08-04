import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { roadmaps, tasks, createRoadmap } = vi.hoisted(() => ({
  roadmaps: vi.fn(),
  tasks: vi.fn(),
  createRoadmap: vi.fn(),
}));

vi.mock("@/stores/spaces/useSpacesBackendStore", () => ({
  SpaceRequestError: class SpaceRequestError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  spacesApi: { roadmaps, tasks, createRoadmap },
}));

import { SpaceRoadmapWorkspace } from "@/features/spaces/SpaceRoadmapWorkspace";

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
    expect(container.textContent).toContain("New roadmap");
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
    expect(container.textContent).not.toContain("New roadmap");
  });
});
