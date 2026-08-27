import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dockTabs } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useWorkspaceTabTitle, WorkspaceTabTitleProvider } from "./useWorkspaceTabTitle";

describe("useWorkspaceTabTitle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useWorkspaceStore.getState().reset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renames only the workspace tab rendering the content", () => {
    useWorkspaceStore.getState().setScope("space:family");
    const first = useWorkspaceStore.getState().openSurface({
      surfaceId: "space",
      groupKey: "space:family:planner",
      title: "Planner",
      route: "/spaces/family/planner/tasks/board",
      instanceKey: "family:planner",
      scopeKey: "space:family",
      instancePolicy: "multiple",
      syncExistingRoute: false,
    });
    const second = useWorkspaceStore.getState().openSurface({
      surfaceId: "space",
      groupKey: "space:family:journal",
      title: "Journal",
      route: "/spaces/family/notes",
      instanceKey: "family:journal",
      scopeKey: "space:family",
      instancePolicy: "multiple",
      syncExistingRoute: false,
    });

    act(() =>
      root.render(
        <WorkspaceTabTitleProvider tabId={second.id}>
          <TitleBridge title="Project brief" />
        </WorkspaceTabTitleProvider>,
      ),
    );

    const tabs = dockTabs(useWorkspaceStore.getState().layout.root);
    expect(tabs.find((tab) => tab.id === first.id)?.title).toBe("Planner");
    expect(tabs.find((tab) => tab.id === second.id)?.title).toBe("Project brief");
  });
});

function TitleBridge(props: { tabId?: string; title: string }) {
  useWorkspaceTabTitle(props.tabId, props.title);
  return null;
}
