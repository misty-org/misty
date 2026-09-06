import type { SpaceRoadmapSnapshot } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadRoadmap } = vi.hoisted(() => ({ loadRoadmap: vi.fn() }));
vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/api/spaces/api", () => ({ spacesApi: { roadmap: loadRoadmap } }));
vi.mock("./RoadmapWorkspaceHelpers", () => ({
  normalizeRoadmapSnapshot: (value: unknown) => value,
}));
vi.mock("./RoadmapSnapshotPreview", () => ({
  RoadmapSnapshotPreview: ({ snapshot }: { snapshot: SpaceRoadmapSnapshot }) => (
    <div aria-label={`${snapshot.roadmap.name} snapshot`}>Canvas snapshot</div>
  ),
}));

import { RoadmapHome } from "./RoadmapHome";
import { RoadmapRuntimeProvider } from "./roadmapRuntime";
import { roadmapTestRuntime } from "./roadmapTestRuntime";

describe("RoadmapHome preview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    loadRoadmap.mockReset().mockResolvedValue(snapshot());
    window.localStorage.setItem("misty:roadmap-pins:user-1:space-1", JSON.stringify(["map-1"]));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    window.localStorage.clear();
    container.remove();
  });

  it("shows a roadmap canvas snapshot without a roadmap count", async () => {
    await act(async () => {
      root.render(
        <RoadmapRuntimeProvider runtime={roadmapTestRuntime({ roadmap: loadRoadmap })}>
          <RoadmapHome
            spaceId="space-1"
            roadmaps={[snapshot().roadmap]}
            canManage
            loading={false}
            error=""
            onCreate={vi.fn()}
            onOpen={vi.fn()}
            onRetry={vi.fn()}
          />
        </RoadmapRuntimeProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const heading = container.querySelector("h1");
    expect(heading?.textContent).toBe("My Roadmaps");
    expect(heading?.closest(".rounded-2xl")).toBeNull();
    expect(heading?.parentElement?.textContent).not.toMatch(/\b1\b/);
    expect(container.querySelector('section[aria-label="Pinned"]')?.textContent).toContain(
      "Launch plan",
    );
    expect(container.querySelector('[aria-label="Launch plan snapshot"]')?.textContent).toBe(
      "Canvas snapshot",
    );
  });
});

function snapshot(): SpaceRoadmapSnapshot {
  return {
    roadmap: {
      id: "map-1",
      space_id: "space-1",
      name: "Launch plan",
      description: "Beta launch",
      graph_version: 1,
      created_by_user_id: "user-1",
      audience_kind: "space",
      created_at: "2026-08-29T00:00:00Z",
      updated_at: "2026-08-29T00:00:00Z",
    },
    milestones: [],
    goals: [],
    nodes: [],
    node_definitions: [],
    edges: [],
    goal_total: 0,
    goal_done: 0,
    milestone_total: 0,
    milestone_done: 0,
    progress_percentage: 0,
  };
}
