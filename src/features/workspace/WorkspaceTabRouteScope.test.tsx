import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dockLeaves, dockTabs } from "./dockTree";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useWorkspaceTabFocused, WorkspaceTabRouteScope } from "./WorkspaceTabRouteScope";

function FocusProbe({ label }: { label: string }) {
  const focused = useWorkspaceTabFocused();
  return <output data-focus={label}>{String(focused)}</output>;
}

function PaneProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  return (
    <div>
      <output data-testid="pane-route">{`${location.pathname}${location.search}`}</output>
      <output data-testid="pane-filter">{params.get("mine")}</output>
      <button type="button" onClick={() => setParams({ mine: "0", status: "open" })}>
        Filter
      </button>
      <button type="button" onClick={() => navigate("/spaces/team/drawings/drawing-2")}>
        Drawing
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
    </div>
  );
}

function OuterProbe() {
  const location = useLocation();
  return <output data-testid="outer-route">{`${location.pathname}${location.search}`}</output>;
}

function Harness({ tabId }: { tabId: string }) {
  const tab = useWorkspaceStore((state) =>
    dockTabs(state.layout.root).find((candidate) => candidate.id === tabId),
  );
  if (!tab) return null;
  return (
    <>
      <WorkspaceTabRouteScope tab={tab}>
        <PaneProbe />
      </WorkspaceTabRouteScope>
      <OuterProbe />
    </>
  );
}

describe("WorkspaceTabRouteScope", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useWorkspaceStore.getState().reset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useWorkspaceStore.getState().reset();
  });

  it("shadows the global URL and writes navigation to the owning tab", async () => {
    const tab = useWorkspaceStore.getState().openSurface({
      surfaceId: "space",
      groupKey: "space:team:planner",
      scopeKey: "space:team",
      instanceKey: "team:planner",
      instancePolicy: "multiple",
      title: "Planner",
      route: "/spaces/team/planner/tasks/board?mine=1",
    });
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/outside"]}>
          <Harness tabId={tab.id} />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="pane-route"]')?.textContent).toBe(
      "/spaces/team/planner/tasks/board?mine=1",
    );
    expect(container.querySelector('[data-testid="outer-route"]')?.textContent).toBe("/outside");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });
    expect(useWorkspaceStore.getState().layout.root.type).toBe("leaf");
    expect(dockTabs(useWorkspaceStore.getState().layout.root)[0]?.route).toBe(
      "/spaces/team/planner/tasks/board?mine=0&status=open",
    );
    expect(container.querySelector('[data-testid="outer-route"]')?.textContent).toBe(
      "/spaces/team/planner/tasks/board?mine=0&status=open",
    );

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Drawing")
        ?.click();
    });
    expect(container.querySelector('[data-testid="pane-route"]')?.textContent).toBe(
      "/spaces/team/drawings/drawing-2",
    );

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Back")
        ?.click();
    });
    expect(container.querySelector('[data-testid="pane-route"]')?.textContent).toBe(
      "/spaces/team/planner/tasks/board?mine=0&status=open",
    );
  });

  it("identifies only the owning tab in the focused split", async () => {
    const store = useWorkspaceStore.getState();
    const first = store.openSurface({
      surfaceId: "space",
      groupKey: "space:team:planner",
      instancePolicy: "multiple",
      forceNew: true,
      title: "First planner",
      route: "/spaces/team/planner/tasks/board",
    });
    const firstPaneId = dockLeaves(useWorkspaceStore.getState().layout.root)[0].id;
    const secondPaneId = store.splitPane(firstPaneId, "right")!;
    const second = store.openSurface({
      surfaceId: "space",
      groupKey: "space:team:planner",
      instancePolicy: "multiple",
      forceNew: true,
      paneId: secondPaneId,
      title: "Second planner",
      route: "/spaces/team/planner/tasks/list",
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkspaceTabRouteScope tab={first}>
            <FocusProbe label="first" />
          </WorkspaceTabRouteScope>
          <WorkspaceTabRouteScope tab={second}>
            <FocusProbe label="second" />
          </WorkspaceTabRouteScope>
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[data-focus="first"]')?.textContent).toBe("false");
    expect(container.querySelector('[data-focus="second"]')?.textContent).toBe("true");

    await act(async () => {
      useWorkspaceStore.getState().focusTab(first.id);
    });
    expect(container.querySelector('[data-focus="first"]')?.textContent).toBe("true");
    expect(container.querySelector('[data-focus="second"]')?.textContent).toBe("false");
  });
});
