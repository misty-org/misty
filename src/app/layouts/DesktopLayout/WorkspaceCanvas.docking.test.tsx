import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { dockPositions } from "@/features/app-shell/dockingLayout";
import { dockingGeometry } from "./dockingGeometry";
import { WorkspaceCanvas } from "./WorkspaceCanvas";

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("./WorkspaceDockTree", async () => {
  const { useEffect } = await import("react");
  return {
    minimumForWorkspaceViews: () => ({ width: 280, height: 180 }),
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
vi.mock("./WorkspaceTabStrip", () => ({ WorkspaceTabStrip: () => null }));
afterEach(cleanup);
it("changes docking orientation without remounting open work or rewriting the pane layout", () => {
  useWorkspaceStore.getState().reset();
  lifecycle.mount.mockClear();
  lifecycle.unmount.mockClear();
  const initial = useWorkspaceStore.getState().layout;
  const view = (
    navigation: (typeof dockPositions)[number],
    tabs: (typeof dockPositions)[number],
    autoHide: boolean,
  ) => {
    const geometry = dockingGeometry({ navigation, tabs, autoHide });
    return (
      <MemoryRouter>
        <div style={geometry.frame}>
          <section style={geometry.content}>
            <WorkspaceCanvas tabPosition={tabs} titlebarInsets={geometry.titlebarInsets} />
          </section>
        </div>
      </MemoryRouter>
    );
  };
  const { rerender, getByTestId } = render(view("left", "top", false));
  const surface = getByTestId("preserved-surface");
  for (const navigation of dockPositions)
    for (const tabs of dockPositions) {
      for (const autoHide of [false, true]) {
        rerender(view(navigation, tabs, autoHide));
        expect(getByTestId("preserved-surface")).toBe(surface);
        expect(useWorkspaceStore.getState().layout).toEqual(initial);
      }
    }
  expect(lifecycle.mount).toHaveBeenCalledTimes(1);
  expect(lifecycle.unmount).not.toHaveBeenCalled();
});
