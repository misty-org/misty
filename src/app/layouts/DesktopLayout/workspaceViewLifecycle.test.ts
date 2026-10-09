import { describe, expect, it, vi } from "vitest";
import { disposeWorkspaceTab } from "./workspaceViewLifecycle";
import type { WorkspaceView } from "@/features/workspace";

const surfaces = vi.hoisted(() => ({ dispose: vi.fn(), get: vi.fn() }));
const routes = vi.hoisted(() => ({ release: vi.fn() }));
vi.mock("@/features/workspace", () => ({
  dockWidgetRegistry: { get: surfaces.get },
  workspaceTabsById: vi.fn(),
}));
vi.mock("@/features/workspace/WorkspaceViewRouteScope", () => ({
  releaseWorkspaceViewRouteHistory: routes.release,
}));

// Closing a browser tab's native page is the runtime bridge's job; disposing
// a view releases its route history and its surface's own state.
describe("workspaceViewLifecycle", () => {
  it("releases route history and disposes the surface state", () => {
    surfaces.get.mockReturnValue({ dispose: surfaces.dispose });
    const tab = {
      id: "tab-1",
      instanceKey: "key-1",
      surfaceId: "browser",
      title: "Browser Tab",
      state: { url: "https://example.com/" },
    } as unknown as WorkspaceView;
    disposeWorkspaceTab(tab);
    expect(routes.release).toHaveBeenCalledWith("tab-1");
    expect(surfaces.get).toHaveBeenCalledWith("browser");
    expect(surfaces.dispose).toHaveBeenCalledWith(tab.state);
  });

  it("tolerates surfaces without a dispose hook", () => {
    surfaces.get.mockReturnValue({});
    const tab = { id: "tab-space", surfaceId: "space" } as unknown as WorkspaceView;
    expect(() => disposeWorkspaceTab(tab)).not.toThrow();
    expect(routes.release).toHaveBeenCalledWith("tab-space");
  });
});
