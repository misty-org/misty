import { useWorkspaceStore, type WorkspaceTab } from "@/features/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NavigateFunction } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesDockWorkspace } from "./useFilesDockWorkspace";

describe("useFilesDockWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.setState({
      activeScopeKey: "global",
      layout: {
        focusedPaneId: "pane-1",
        root: {
          type: "leaf",
          id: "pane-1",
          activeTabId: filesTab.id,
          tabs: [filesTab],
        },
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useWorkspaceStore.getState().reset();
  });

  it("keeps the dock path snapshot stable when the workspace state is unchanged", async () => {
    let renderCount = 0;
    const navigate = vi.fn() as unknown as NavigateFunction;

    function Harness() {
      renderCount += 1;
      useFilesDockWorkspace({
        workspaceId: filesTab.id,
        activePaneId: "explorer-pane",
        activePath: "/Users/misty/Documents",
        initialized: false,
        embedded: false,
        navigate,
      });
      return null;
    }

    await act(async () => root.render(<Harness />));

    expect(renderCount).toBe(1);
  });

  it("synchronizes the active path back to the workspace tab state when user navigates", async () => {
    const navigate = vi.fn() as unknown as NavigateFunction;

    function Harness(props: { activePath: string }) {
      useFilesDockWorkspace({
        workspaceId: filesTab.id,
        activePaneId: "explorer-pane",
        activePath: props.activePath,
        initialized: true,
        embedded: true,
        navigate,
      });
      return null;
    }

    await act(async () => root.render(<Harness activePath="/Users/misty/Documents" />));

    // Now simulate the user navigating to /Users/misty/Downloads
    await act(async () => root.render(<Harness activePath="/Users/misty/Downloads" />));

    const rootNode = useWorkspaceStore.getState().layout.root;
    const updatedTab =
      rootNode.type === "leaf" ? rootNode.tabs.find((t) => t.id === filesTab.id) : null;

    expect(updatedTab?.state).toEqual({ version: 1, path: "/Users/misty/Downloads" });
    expect(updatedTab?.title).toBe("Downloads");
  });
});

const filesTab: WorkspaceTab = {
  id: "files-tab",
  surfaceId: "files",
  groupKey: "tool:files",
  instanceKey: "files-tab",
  title: "Documents",
  route: "/files",
  sidebarVisible: true,
  state: { version: 1, path: "/Users/misty/Documents" },
  createdAt: 1,
  lastFocusedAt: 1,
};
