import { createDockLeaf, insertDockSplit, type WorkspaceView } from "@/features/app-windows";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDockTree } from "./WorkspaceDockTree";

vi.mock("./WorkspaceSurface", () => ({
  EmptyWorkspacePane: () => <div data-empty-pane />,
  WorkspaceSurface: (props: { tab: WorkspaceView; active: boolean }) => (
    <output data-workspace-surface={props.tab.id} data-active={String(props.active)} />
  ),
}));

vi.mock("@/features/agents/runs/markdown/AiPaneHost", () => ({
  AiPaneHost: (props: { children: ReactNode }) => props.children,
}));

afterEach(cleanup);

describe("WorkspaceDockTree tab lifecycle", () => {
  it("keeps every open surface mounted while only exposing the active one", () => {
    const files = tab("files", "/spaces/family/files");
    const lab = tab("lab", "/spaces/family/lab");
    const pane = createDockLeaf([files, lab]);
    pane.activeViewId = files.id;
    const props = {
      node: pane,
      focusedPaneId: pane.id,
      lastUsedViewByGroup: {},
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onMoveView: vi.fn(() => true),
      onDockView: vi.fn(() => true),
      onSplitPane: vi.fn(() => null),
      onClosePane: vi.fn(),
      onResizeSplit: vi.fn(),
    };

    const view = render(<WorkspaceDockTree {...props} />);
    expect(view.container.querySelectorAll("[data-workspace-surface]")).toHaveLength(2);
    expect(view.container.querySelector(`[data-workspace-surface="${files.id}"]`)).not.toBeNull();
    expect(view.container.querySelector(`[data-workspace-surface="${lab.id}"]`)).not.toBeNull();

    const filesElement = view.container.querySelector(`[data-workspace-surface="${files.id}"]`);
    const labElement = view.container.querySelector(`[data-workspace-surface="${lab.id}"]`);
    const otherPane = createDockLeaf([]);
    const split = insertDockSplit(pane, pane.id, otherPane, "right");
    view.rerender(<WorkspaceDockTree {...props} node={split} />);
    expect(view.container.querySelector(`[data-workspace-surface="${files.id}"]`)).toBe(
      filesElement,
    );
    if (split.type !== "split") throw new Error("Expected split");
    view.rerender(
      <WorkspaceDockTree
        {...props}
        node={{ ...split, first: split.second, second: split.first }}
      />,
    );
    expect(view.container.querySelector(`[data-workspace-surface="${files.id}"]`)).toBe(
      filesElement,
    );
    const stacked = insertDockSplit(otherPane, otherPane.id, pane, "down");
    view.rerender(<WorkspaceDockTree {...props} node={stacked} />);
    expect(view.container.querySelector(`[data-workspace-surface="${files.id}"]`)).toBe(
      filesElement,
    );
    view.rerender(<WorkspaceDockTree {...props} node={pane} />);
    expect(view.container.querySelector(`[data-workspace-surface="${files.id}"]`)).toBe(
      filesElement,
    );

    const nextPane = { ...pane, views: [lab, files], activeViewId: lab.id };
    act(() => {
      view.rerender(<WorkspaceDockTree {...props} node={nextPane} />);
    });

    expect(view.container.querySelectorAll("[data-workspace-surface]")).toHaveLength(2);
    expect(view.container.querySelector(`[data-workspace-surface="${files.id}"]`)).toBe(
      filesElement,
    );
    expect(view.container.querySelector(`[data-workspace-surface="${lab.id}"]`)).toBe(
      labElement,
    );
    expect(
      view.container
        .querySelector(`[data-workspace-surface="${files.id}"]`)
        ?.closest('[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(
      view.container
        .querySelector(`[data-workspace-surface="${lab.id}"]`)
        ?.closest('[aria-hidden="false"]'),
    ).not.toBeNull();
  });
});

function tab(tool: "files" | "lab", route: string): WorkspaceView {
  return {
    id: `tab-${tool}`,
    surfaceId: "space",
    groupKey: `space:family:${tool}`,
    instanceKey: `family:${tool}`,
    title: tool === "files" ? "Files" : "Lab",
    route,
    sidebarVisible: true,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
  };
}
