import { useSpacesStore } from "@/features/spaces";
import { ShortcutRuntime } from "@/features/shortcuts";
import {
  configureWorkspaceDefaultTab,
  dockLeaves,
  dockTabs,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceTab,
} from "@/features/workspace";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import { spaceFixture } from "./GlobalNavigator.testFixtures";
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
    useWorkspaceStore.getState().setScope("space:family");
    useSpacesStore.setState({ spaces: [], snapshotReady: false });
  });
  afterEach(() => {
    cleanup();
    if (originalAnimate) HTMLElement.prototype.animate = originalAnimate;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
  });

  it("creates and cycles Space-local windows through the central dispatcher", () => {
    render(
      <MemoryRouter initialEntries={["/spaces/family"]}>
        <ShortcutRuntime />
        <WorkspaceCanvas />
      </MemoryRouter>,
    );
    const firstWindowId = useWorkspaceStore.getState().activeVirtualWindowId;
    expect(animate).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true });
    const windows = useWorkspaceStore.getState().virtualWindowsByScope["space:family"] ?? [];
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

  it("keeps Home open when the final tab closes", async () => {
    useSpacesStore.setState({
      spaces: [{ ...spaceFixture, id: "family" }],
      snapshotReady: true,
    });

    render(
      <MemoryRouter initialEntries={["/spaces/family/home"]}>
        <WorkspaceCanvas />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
        { title: "Home", route: "/spaces/family/home" },
      ]);
    });

    act(() => {
      const request = workspaceSurfaceFromRoute("/spaces/family/home");
      if (!request) throw new Error("Expected a Home workspace surface");
      useWorkspaceStore.getState().openSurface(request);
      useWorkspaceStore.getState().openSurface(request);
    });
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toHaveLength(1);

    const homeTab = dockTabs(useWorkspaceStore.getState().layout.root)[0];
    let agentsTab: WorkspaceTab | undefined;
    act(() => {
      const request = workspaceSurfaceFromRoute("/agents");
      if (!request) throw new Error("Expected an Agents workspace surface");
      agentsTab = useWorkspaceStore.getState().openSurface(request);
    });
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { id: homeTab.id, title: "Home", route: "/spaces/family/home" },
      { id: agentsTab!.id, title: "Agents", route: "/apps/agents" },
    ]);

    act(() => {
      expect(useWorkspaceStore.getState().closeTab(agentsTab!.id)).toBe(true);
      expect(useWorkspaceStore.getState().closeTab(homeTab.id)).toBe(true);
    });
    expect(dockTabs(useWorkspaceStore.getState().layout.root)).toMatchObject([
      { title: "Home", route: "/spaces/family/home" },
    ]);
  });

  it("activates the configured default instead of copying the current tab into a split", async () => {
    useSpacesStore.setState({
      spaces: [{ ...spaceFixture, id: "family" }],
      snapshotReady: true,
    });
    const initialHome = dockTabs(useWorkspaceStore.getState().layout.root)[0];
    const journalRequest = workspaceSurfaceFromRoute("/spaces/family/notes");
    if (!initialHome || !journalRequest) throw new Error("Expected Home and Journal surfaces");
    const journal = useWorkspaceStore.getState().openSurface(journalRequest);
    useWorkspaceStore.getState().closeTab(initialHome.id);

    const view = render(
      <MemoryRouter initialEntries={[journal.route]}>
        <LocationProbe />
        <WorkspaceCanvas />
      </MemoryRouter>,
    );

    fireEvent.click(view.getByRole("button", { name: "Split down" }));

    await waitFor(() => {
      const panes = dockLeaves(useWorkspaceStore.getState().layout.root);
      expect(panes).toHaveLength(2);
      const focused = panes.find(
        (pane) => pane.id === useWorkspaceStore.getState().layout.focusedPaneId,
      );
      expect(focused?.tabs.find((tab) => tab.id === focused.activeTabId)).toMatchObject({
        title: "Home",
        route: "/spaces/family/home",
      });
      expect(view.getByTestId("location").textContent).toBe("/spaces/family/home");
    });
  });
});
