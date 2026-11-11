import { invokeShortcutCommand } from "@/features/shortcuts";
import { ShortcutRuntime } from "@/app/ShortcutRuntime";
import "@/app/featureSeams";
import {
  allLayoutViews,
  configureWorkspaceDefaultView,
  dockLeaves,
  dockTreeViews,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/app-windows";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { WorkspaceCanvas } from "./WorkspaceCanvas";

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
vi.mock("./dockSplitFit", () => ({
  minimumForWorkspaceViews: () => ({ width: 280, height: 180 }),
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <button onClick={() => navigate(-1)}>Go back in shell</button>
    </>
  );
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
    configureWorkspaceDefaultView(1);
    useWorkspaceStore.getState().reset();
  });
  afterEach(() => {
    configureWorkspaceDefaultView(1);
    cleanup();
    if (originalAnimate) HTMLElement.prototype.animate = originalAnimate;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
  });

  it("does not add shell history when the sidebar opens a chat", () => {
    const ui = render(
      <MemoryRouter initialEntries={["/before", "/browser"]} initialIndex={1}>
        <WorkspaceCanvas />
        <LocationProbe />
      </MemoryRouter>,
    );
    fireEvent.click(ui.getByRole("button", { name: "New chat" }));
    expect(ui.getByTestId("location").textContent).toBe("/agents");
    fireEvent.click(ui.getByRole("button", { name: "Go back in shell" }));
    expect(ui.getByTestId("location").textContent).toBe("/before");
  });

  it("leaves the final tab closed until the new-tab command runs", async () => {
    configureWorkspaceDefaultView(3);
    useWorkspaceStore.getState().reset();
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <ShortcutRuntime />
        <WorkspaceCanvas />
      </MemoryRouter>,
    );
    const initial = allLayoutViews(useWorkspaceStore.getState().layout)[0];
    act(() => {
      expect(useWorkspaceStore.getState().closeView(initial.id)).toBe(true);
    });
    await waitFor(() => expect(allLayoutViews(useWorkspaceStore.getState().layout)).toEqual([]));
    act(() => void invokeShortcutCommand("workspace.new_tab"));
    const reopened = allLayoutViews(useWorkspaceStore.getState().layout);
    expect(reopened).toMatchObject([{ surfaceId: "agents", route: "/agents" }]);
    expect(reopened[0].id).not.toBe(initial.id);
  });

  it("creates an independent new tab and lets the previous tab close", () => {
    configureWorkspaceDefaultView(3);
    useWorkspaceStore.getState().reset();
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <ShortcutRuntime />
        <WorkspaceCanvas />
      </MemoryRouter>,
    );
    const initial = allLayoutViews(useWorkspaceStore.getState().layout)[0];
    act(() => void invokeShortcutCommand("workspace.new_tab"));
    const views = allLayoutViews(useWorkspaceStore.getState().layout);
    expect(views).toHaveLength(2);
    expect(new Set(views.map((tab) => tab.instanceKey)).size).toBe(2);
    expect(views.every((tab) => tab.surfaceId === "agents")).toBe(true);
    act(() => {
      expect(useWorkspaceStore.getState().closeView(initial.id)).toBe(true);
    });
    const remaining = allLayoutViews(useWorkspaceStore.getState().layout);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).not.toBe(initial.id);
  });

  it("opens a new Agents page in a split while preserving the Agents panel", async () => {
    const initial = dockTreeViews(useWorkspaceStore.getState().layout.root)[0];
    const request = workspaceSurfaceFromRoute("/agents");
    if (!request) throw new Error("Expected Agents surface");
    const agents = useWorkspaceStore.getState().openSurface(request);
    useWorkspaceStore.getState().closeView(initial.id);
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
      expect(focused?.views.find((tab) => tab.id === focused.activeViewId)).toMatchObject({
        title: "Agents",
        route: "/agents",
        surfaceId: "agents",
        placeholder: true,
      });
      expect(dockTreeViews(layout.root)).toContainEqual(
        expect.objectContaining({ id: agents.id, surfaceId: "agents" }),
      );
      expect(view.getByTestId("location").textContent).toBe("/agents");
    });
  });
});
