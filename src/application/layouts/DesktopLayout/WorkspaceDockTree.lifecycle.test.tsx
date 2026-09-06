import {
  createDockLeaf,
  type WorkspaceTab,
  type WorkspaceVirtualWindow,
} from "@/features/workspace";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDockTree } from "./WorkspaceDockTree";

vi.mock("./WorkspaceSurface", () => ({
  WorkspaceSurface: (props: { tab: WorkspaceTab; active: boolean }) => (
    <output data-workspace-surface={props.tab.id} data-active={String(props.active)} />
  ),
}));

vi.mock("@/features/ai-surface/AiPaneHost", () => ({
  AiPaneHost: (props: { children: ReactNode }) => props.children,
}));

afterEach(cleanup);

describe("WorkspaceDockTree tab lifecycle", () => {
  it("keeps every open surface mounted while only exposing the active one", () => {
    const journal = tab("journal", "/spaces/family/notes");
    const planner = tab("planner", "/spaces/family/planner/tasks/board");
    const pane = createDockLeaf([journal, planner]);
    pane.activeTabId = journal.id;
    const workspaceWindow: WorkspaceVirtualWindow = {
      id: "window-1",
      title: "Window 1",
      layout: { root: pane, focusedPaneId: pane.id },
      createdAt: 1,
      lastFocusedAt: 1,
    };
    const props = {
      node: pane,
      focusedPaneId: pane.id,
      lastUsedTabByGroup: {},
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onOpenNewTab: vi.fn(),
      onMoveTab: vi.fn(() => true),
      onDockTab: vi.fn(() => true),
      onSplitPane: vi.fn(() => null),
      onClosePane: vi.fn(),
      virtualWindows: [workspaceWindow],
      activeVirtualWindowId: workspaceWindow.id,
      canReopenVirtualWindow: false,
      onSelectVirtualWindow: vi.fn(),
      onCreateVirtualWindow: vi.fn(),
      onCloseVirtualWindow: vi.fn(),
      onReopenVirtualWindow: vi.fn(),
      onResizeSplit: vi.fn(),
    };

    const view = render(<WorkspaceDockTree {...props} />);
    expect(view.container.querySelectorAll("[data-workspace-surface]")).toHaveLength(2);
    expect(view.container.querySelector(`[data-workspace-surface="${journal.id}"]`)).not.toBeNull();
    expect(view.container.querySelector(`[data-workspace-surface="${planner.id}"]`)).not.toBeNull();

    const nextPane = { ...pane, activeTabId: planner.id };
    act(() => {
      view.rerender(
        <WorkspaceDockTree
          {...props}
          node={nextPane}
          virtualWindows={[
            { ...workspaceWindow, layout: { root: nextPane, focusedPaneId: nextPane.id } },
          ]}
        />,
      );
    });

    expect(view.container.querySelectorAll("[data-workspace-surface]")).toHaveLength(2);
    expect(
      view.container
        .querySelector(`[data-workspace-surface="${journal.id}"]`)
        ?.closest('[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(
      view.container
        .querySelector(`[data-workspace-surface="${planner.id}"]`)
        ?.closest('[aria-hidden="false"]'),
    ).not.toBeNull();
  });
});

function tab(tool: "journal" | "planner", route: string): WorkspaceTab {
  return {
    id: `tab-${tool}`,
    surfaceId: "space",
    groupKey: `space:family:${tool}`,
    instanceKey: `family:${tool}`,
    title: tool === "journal" ? "Journal" : "Planner",
    route,
    sidebarVisible: true,
    state: {},
    createdAt: 1,
    lastFocusedAt: 1,
  };
}
