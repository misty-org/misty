import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { tabSides } from "@/features/app-shell/dockingLayout";
import { dockingGeometry } from "./dockingGeometry";
import { WorkspaceCanvas } from "./WorkspaceCanvas";

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("./WorkspaceDockTree", async () => {
  const { useEffect } = await import("react");
  return {
    WorkspaceDockTree: () => {
      useEffect(() => {
        lifecycle.mount();
        return () => {
          lifecycle.unmount();
        };
      }, []);
      return <div data-testid="preserved-surface" />;
    },
  };
});
vi.mock("./dockSplitFit", () => ({
  minimumForWorkspaceViews: () => ({ width: 280, height: 180 }),
}));
vi.mock("./WorkspaceTabStrip", () => ({ WorkspaceTabStrip: () => null }));
afterEach(cleanup);
it("moves the tab sidebar without remounting open work or rewriting the pane layout", () => {
  useWorkspaceStore.getState().reset();
  lifecycle.mount.mockClear();
  lifecycle.unmount.mockClear();
  const initial = useWorkspaceStore.getState().layout;
  const view = (tabs: (typeof tabSides)[number]) => {
    const geometry = dockingGeometry({ navigation: tabs === "left" ? "right" : "left", tabs });
    return (
      <MemoryRouter>
        <div style={geometry.frame}>
          <section style={geometry.content}>
            <WorkspaceCanvas tabPosition={tabs} />
          </section>
        </div>
      </MemoryRouter>
    );
  };
  const { rerender, getByTestId } = render(view("left"));
  const surface = getByTestId("preserved-surface");
  for (const tabs of [...tabSides, ...tabSides]) {
    rerender(view(tabs));
    expect(getByTestId("preserved-surface")).toBe(surface);
    expect(useWorkspaceStore.getState().layout).toEqual(initial);
  }
  expect(lifecycle.mount).toHaveBeenCalledTimes(1);
  expect(lifecycle.unmount).not.toHaveBeenCalled();
});
it("keeps tab panels direct children of the pane frame so its rounded corner applies", () => {
  useWorkspaceStore.getState().reset();
  const { container } = render(
    <MemoryRouter>
      <WorkspaceCanvas tabPosition="left" />
    </MemoryRouter>,
  );
  // docking.css draws the pane corner and seam on `[data-workspace-panes] > [role="tabpanel"]`.
  expect(container.querySelector('[data-workspace-panes] > [role="tabpanel"]')).not.toBeNull();
});
