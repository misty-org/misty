import type { SpaceRoadmapSnapshot } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { RoadmapNode } from "@/features/spaces/roadmap/spaceRoadmap/RoadmapCanvasNodes";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  roadmaps: vi.fn(),
  roadmap: vi.fn(),
  tasks: vi.fn(),
  updateRoadmapLayout: vi.fn(),
}));

const editor = vi.hoisted(() => ({
  props: undefined as
    | {
        snapshot: SpaceRoadmapSnapshot;
        saveState: string;
        error: string;
        saveLayout: (nodes: RoadmapNode[]) => void;
      }
    | undefined,
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
  spacesApi: api,
}));

vi.mock("@/features/spaces/roadmap/spaceRoadmap/RoadmapEditor", () => ({
  RoadmapEditor: (props: NonNullable<typeof editor.props>) => {
    editor.props = props;
    return <div data-testid="roadmap-editor">{props.saveState}</div>;
  },
  ErrorBanner: ({ message }: { message: string }) => <div>{message}</div>,
}));

import { SpaceRoadmapWorkspace } from "@/features/spaces/roadmap/SpaceRoadmapWorkspace";

describe("SpaceRoadmapWorkspace optimistic layout saves", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    editor.props = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    api.roadmaps.mockResolvedValue({ roadmaps: [] });
    api.tasks.mockResolvedValue({ tasks: [] });
    api.roadmap.mockResolvedValue(snapshot());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("moves nodes immediately while the layout request is still pending", async () => {
    let finishSave!: (value: { graph_version: number }) => void;
    api.updateRoadmapLayout.mockReturnValue(
      new Promise<{ graph_version: number }>((resolve) => {
        finishSave = resolve;
      }),
    );
    await renderEditor();

    await act(async () => {
      editor.props?.saveLayout([movedMilestone(480, 220)]);
      await Promise.resolve();
    });

    expect(editor.props?.snapshot.milestones[0]).toMatchObject({
      position_x: 480,
      position_y: 220,
    });
    expect(editor.props?.saveState).toBe("saving");

    await act(async () => {
      finishSave({ graph_version: 2 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editor.props?.snapshot.roadmap.graph_version).toBe(2);
    expect(editor.props?.saveState).toBe("saved");
  });

  it("keeps the optimistic position and exposes a failed-save state", async () => {
    api.updateRoadmapLayout.mockRejectedValue(new Error("Connection lost"));
    await renderEditor();

    await act(async () => {
      editor.props?.saveLayout([movedMilestone(560, 260)]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editor.props?.snapshot.milestones[0]).toMatchObject({
      position_x: 560,
      position_y: 260,
    });
    expect(editor.props?.saveState).toBe("unsaved");
    expect(editor.props?.error).toContain("Connection lost");
  });

  async function renderEditor() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/spaces/space-1/planner/roadmaps/map-1"]}>
          <SpaceRoadmapWorkspace spaceId="space-1" roadmapId="map-1" canManage />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(editor.props).toBeDefined();
  }
});

function movedMilestone(x: number, y: number): RoadmapNode {
  return {
    id: "milestone-1",
    type: "milestone",
    position: { x, y },
    data: {
      canvasKind: "milestone",
      label: "Beta ready",
      subtitle: "",
      progress: 0,
      status: "in_progress",
      color: "emerald",
      icon: "flag",
    },
  };
}

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
    milestones: [
      {
        id: "milestone-1",
        space_id: "space-1",
        roadmap_id: "map-1",
        title: "Beta ready",
        description: "",
        rank: 1,
        goal_total: 0,
        goal_done: 0,
        status: "in_progress",
        position_x: 120,
        position_y: 90,
        width: 420,
        height: 320,
        version: 1,
        created_at: "2026-08-29T00:00:00Z",
        updated_at: "2026-08-29T00:00:00Z",
      },
    ],
    goals: [],
    nodes: [],
    node_definitions: [],
    edges: [],
    goal_total: 0,
    goal_done: 0,
    milestone_total: 1,
    milestone_done: 0,
    progress_percentage: 0,
  };
}
