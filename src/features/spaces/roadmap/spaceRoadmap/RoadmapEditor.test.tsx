import type { SpaceRoadmapSnapshot } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/shortcuts", () => ({ useShortcutHandler: vi.fn() }));

vi.mock("@/features/spaces/roadmap/spaceRoadmap/RoadmapCanvas", () => ({
  RoadmapCanvas: () => <main aria-label="Roadmap canvas">Canvas</main>,
}));

vi.mock("@/features/spaces/roadmap/spaceRoadmap/RoadmapNodeDrawer", () => ({
  RoadmapNodeDrawer: ({ open }: { open: boolean }) =>
    open ? <aside aria-label="Node tools">Node tools</aside> : null,
}));

vi.mock("@/features/spaces/roadmap/spaceRoadmap/RoadmapExecutionRail", () => ({
  RoadmapExecutionRail: () => <aside aria-label="Daily plan">Daily plan</aside>,
}));

vi.mock("@/features/spaces/roadmap/spaceRoadmap/RoadmapOutline", () => ({
  RoadmapOutline: () => <div>Outline</div>,
}));

vi.mock("@/features/spaces/roadmap/spaceRoadmap/RoadmapInspector", () => ({
  RoadmapInspector: () => <div>Inspector</div>,
}));

import { RoadmapEditor } from "./RoadmapEditor";

describe("RoadmapEditor layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("keeps the canvas between independently toggled left and right drawers", async () => {
    await act(async () => root.render(<Harness />));

    const nodeTools = getRegion("Node tools");
    const canvas = getRegion("Roadmap canvas");
    const dailyPlan = getRegion("Daily plan");
    expect(
      nodeTools.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      canvas.compareDocumentPosition(dailyPlan) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const hideNodes = getButton("Hide node tools");
    const hideDailyPlan = getButton("Hide daily plan");
    expect(hideNodes.getAttribute("aria-pressed")).toBe("true");
    expect(hideDailyPlan.getAttribute("aria-pressed")).toBe("true");

    await act(async () =>
      hideNodes.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector('[aria-label="Node tools"]')).toBeNull();
    expect(getButton("Show node tools").getAttribute("aria-pressed")).toBe("false");

    await act(async () =>
      hideDailyPlan.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector('[aria-label="Daily plan"]')).toBeNull();
    expect(getButton("Show daily plan").getAttribute("aria-pressed")).toBe("false");
  });

  it("uses a compact Journal-style title row with visible save status", async () => {
    await act(async () => root.render(<Harness />));

    const header = container.querySelector("header");
    expect(header?.textContent).toContain("Roadmaps");
    expect(header?.textContent).toContain("Launch plan");
    expect(header?.textContent).toContain("Saved");
    expect(header?.querySelector("h1")?.textContent).toBe("Launch plan");
  });

  function getButton(label: string) {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button).not.toBeNull();
    return button!;
  }

  function getRegion(label: string) {
    const region = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    expect(region).not.toBeNull();
    return region!;
  }
});

function Harness() {
  const [nodeDrawerOpen, setNodeDrawerOpen] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [expandedGoalIds, setExpandedGoalIds] = useState(new Set<string>());
  const [placementRequest, setPlacementRequest] = useState<{
    paletteId: string;
    token: string;
  }>();
  const [, setSaveState] = useState<"saved" | "saving" | "unsaved" | "conflict">("saved");
  return (
    <RoadmapEditor
      spaceId="space-1"
      canManage
      snapshot={snapshot()}
      tasks={[]}
      saveState="saved"
      error=""
      selectedId={selectedId}
      expandedGoalIds={expandedGoalIds}
      nodeDrawerOpen={nodeDrawerOpen}
      placementRequest={placementRequest}
      palette={[]}
      navigate={vi.fn()}
      mutate={vi.fn()}
      load={vi.fn()}
      retrySave={vi.fn()}
      archiveRoadmap={vi.fn()}
      addPaletteItem={vi.fn()}
      saveLayout={vi.fn()}
      setSaveState={setSaveState}
      setSelectedId={setSelectedId}
      setExpandedGoalIds={setExpandedGoalIds}
      setNodeDrawerOpen={setNodeDrawerOpen}
      setPlacementRequest={setPlacementRequest}
    />
  );
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
