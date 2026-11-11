import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { WorkspaceView } from "@/features/app-windows/tabs/workspaceViews";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { WorkspaceSurface } from "./WorkspaceSurface";

vi.mock("@/features/app-windows", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WorkspaceViewRouteScope: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/spaces/overview/SpaceWorkspaceSurface", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  SpaceWorkspaceSurface: () => <input aria-label="Space draft" defaultValue="Keep my work" />,
}));
vi.mock("@/features/agents", async () => {
  const { lazy, Suspense } = await import("react");
  const FailedModule = lazy(() =>
    Promise.reject(new TypeError("Importing a module script failed.")),
  );
  return {
    AgentsPage: () => (
      <Suspense>
        <FailedModule />
      </Suspense>
    ),
  };
});

const agentsTab: WorkspaceView = {
  id: "agents",
  surfaceId: "agents",
  groupKey: "tool:agents",
  instanceKey: "agents",
  title: "Agents",
  route: "/agents",
  sidebarVisible: true,
  state: null,
  createdAt: 1,
  lastFocusedAt: 1,
};
const spaceTab: WorkspaceView = {
  ...agentsTab,
  id: "space",
  surfaceId: "space",
  groupKey: "space:one",
  route: "/spaces/one",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
});
afterEach(cleanup);

it("contains a rejected lazy module without unmounting another page or navigation", async () => {
  render(
    <RenderErrorBoundary>
      <nav>Window navigation</nav>
      <WorkspaceSurface tab={spaceTab} />
      <WorkspaceSurface tab={agentsTab} />
    </RenderErrorBoundary>,
  );
  const draft = screen.getByLabelText("Space draft");
  fireEvent.change(draft, { target: { value: "Unsaved work" } });
  await screen.findByText("This tab could not be loaded");
  expect(screen.getByLabelText("Space draft")).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Unsaved work");
  expect(screen.getByText("Window navigation")).toBeTruthy();
  expect(screen.queryByText("Workspace render failed")).toBeNull();
});

it("can navigate to another surface after a tab failed", async () => {
  const { rerender } = render(<WorkspaceSurface tab={agentsTab} />);
  await screen.findByText("This tab could not be loaded");
  rerender(<WorkspaceSurface tab={spaceTab} />);
  expect(screen.getByLabelText("Space draft")).toBeTruthy();
  expect(screen.queryByText("This tab could not be loaded")).toBeNull();
});

it("does not reset workspace snapshots when retrying a failed module request", async () => {
  localStorage.setItem("misty.providers.multipanel.v1", "saved-layout");
  localStorage.setItem("misty.explorer.fileTable.columnOrder", "saved-columns");
  render(<WorkspaceSurface tab={agentsTab} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reload Misty" }));
  expect(localStorage.getItem("misty.providers.multipanel.v1")).toBe("saved-layout");
  expect(localStorage.getItem("misty.explorer.fileTable.columnOrder")).toBe("saved-columns");
  expect(localStorage.getItem("misty.explorer.resetWorkspaceOnNextLoad.v1")).toBeNull();
});
