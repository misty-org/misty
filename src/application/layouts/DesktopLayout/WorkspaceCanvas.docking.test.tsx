import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { WorkspaceCanvas } from "./WorkspaceCanvas";

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }));
vi.mock("./WorkspaceDockTree", async () => {
  const { useEffect } = await import("react");
  return {
    minimumForWorkspaceTabs: () => ({ width: 280, height: 180 }),
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
vi.mock("./WorkspaceLayoutTabs", () => ({ WorkspaceLayoutTabs: () => null }));
afterEach(cleanup);
it("changes docking orientation without remounting open work or rewriting the pane layout", () => {
  useWorkspaceStore.getState().reset();
  lifecycle.mount.mockClear();
  lifecycle.unmount.mockClear();
  const initial = useWorkspaceStore.getState().layout;
  const { rerender, getByTestId } = render(
    <MemoryRouter>
      <WorkspaceCanvas tabPosition="top" />
    </MemoryRouter>,
  );
  const surface = getByTestId("preserved-surface");
  for (const tabPosition of ["left", "right", "bottom", "top"] as const) {
    rerender(
      <MemoryRouter>
        <WorkspaceCanvas tabPosition={tabPosition} />
      </MemoryRouter>,
    );
    expect(getByTestId("preserved-surface")).toBe(surface);
    expect(useWorkspaceStore.getState().layout).toEqual(initial);
  }
  expect(lifecycle.mount).toHaveBeenCalledTimes(1);
  expect(lifecycle.unmount).not.toHaveBeenCalled();
});
