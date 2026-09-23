import { ShortcutRuntime } from "@/features/shortcuts";
import {
  allLayoutViews,
  configureWorkspaceDefaultTab,
  dockLeaves,
  dockTabs,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import { virtualWindowTransition } from "./useVirtualWindowTransition";

vi.mock("./WorkspaceDockTree", () => ({
  WorkspaceDockTree: (props: {
    focusedPaneId: string;
    onSplitPane: (paneId: string, direction: "right" | "down") => string | null;
  }) => (
    <div data-testid="workspace-dock">
      <button type="button" onClick={() => props.onSplitPane(props.focusedPaneId, "down")}>
        Split down
      </button>
    </div>
  ),
  minimumForWorkspaceTabs: () => ({ width: 280, height: 180 }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe("WorkspaceCanvas virtual window shortcuts", () => {
  const originalAnimate = HTMLElement.prototype.animate;
  const animate = vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation);

  beforeEach(() => {
    animate.mockClear();
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
    configureWorkspaceDefaultTab(0);
  });
  afterEach(() => {
    configureWorkspaceDefaultTab(0);
    cleanup();
    if (originalAnimate) HTMLElement.prototype.animate = originalAnimate;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
  });

  it("creates and cycles global browser windows through the central dispatcher", () => {
    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <ShortcutRuntime />
        <WorkspaceCanvas />
      </MemoryRouter>,
    );
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    expect(animate).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true });
    const windows = useWorkspaceStore.getState().virtualWindowsByScope.global ?? [];
    expect(windows).toHaveLength(2);
    expect(useWorkspaceStore.getState().activeVirtualWindowId).not.toBe(firstWindowId);
    expect(animate).toHaveBeenLastCalledWith(expect.any(Array), virtualWindowTransition);

    fireEvent.keyDown(window, {
      key: "`",
      code: "Backquote",
      metaKey: true,
    });
    expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(firstWindowId);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("opens Google when the final tab closes without a Spaces snapshot", async () => {
    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <WorkspaceCanvas />
      </MemoryRouter>,
    );
    const initial = dockTabs(useWorkspaceStore.getState().layout.root)[0];
    act(() => {
      expect(useWorkspaceStore.getState().closeTab(initial.id)).toBe(true);
    });
    await waitFor(() => {
      expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
        { title: "Google", route: "/browser", surfaceId: "browser" },
      ]);
    });
    expect(dockTabs(useWorkspaceStore.getState().layout.root)[0].id).not.toBe(initial.id);
  });

  it("creates an independent Google tab and lets the previous tab close", () => {
    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <ShortcutRuntime />
        <WorkspaceCanvas />
      </MemoryRouter>,
    );
    const initial = allLayoutViews(useWorkspaceStore.getState().layout)[0];
    fireEvent.keyDown(window, { key: "t", code: "KeyT", metaKey: true });
    const views = allLayoutViews(useWorkspaceStore.getState().layout);
    expect(views).toHaveLength(2);
    expect(new Set(views.map((tab) => tab.instanceKey)).size).toBe(2);
    expect(views.every((tab) => tab.surfaceId === "browser" && !tab.placeholder)).toBe(true);
    act(() => {
      expect(useWorkspaceStore.getState().closeTab(initial.id)).toBe(true);
    });
    const remaining = allLayoutViews(useWorkspaceStore.getState().layout);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).not.toBe(initial.id);
  });

  it("opens Google in a new split while preserving the Agents panel", async () => {
    const initial = dockTabs(useWorkspaceStore.getState().layout.root)[0];
    const request = workspaceSurfaceFromRoute("/agents");
    if (!request) throw new Error("Expected Agents surface");
    const agents = useWorkspaceStore.getState().openSurface(request);
    useWorkspaceStore.getState().closeTab(initial.id);
    const view = render(
      <MemoryRouter initialEntries={[agents.route]}>
        <LocationProbe />
        <WorkspaceCanvas />
      </MemoryRouter>,
    );
    fireEvent.click(view.getByRole("button", { name: "Split down" }));
    await waitFor(() => {
      const layout = useWorkspaceStore.getState().layout;
      const panes = dockLeaves(layout.root);
      expect(panes).toHaveLength(2);
      const focused = panes.find((pane) => pane.id === layout.focusedPaneId);
      expect(focused?.tabs.find((tab) => tab.id === focused.activeTabId)).toMatchObject({
        title: "Google",
        route: "/browser",
        surfaceId: "browser",
      });
      expect(dockTabs(layout.root)).toContainEqual(
        expect.objectContaining({ id: agents.id, surfaceId: "agents" }),
      );
      expect(view.getByTestId("location").textContent).toBe("/browser");
    });
  });
});
