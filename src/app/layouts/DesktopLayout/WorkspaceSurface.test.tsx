import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { WorkspaceTab } from "@/features/workspace/model";
import { RenderErrorBoundary } from "../RenderErrorBoundary";
import { WorkspaceSurface } from "./WorkspaceSurface";

vi.mock("@/features/workspace", () => ({
  WorkspaceTabRouteScope: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/features/spaces/SpaceWorkspaceSurface", () => ({
  SpaceWorkspaceSurface: () => <div>Space content</div>,
}));
vi.mock("@/features/agents", () => ({ AgentsPage: () => <div>Agents content</div> }));
vi.mock("@/features/browser/workspace/BrowserWorkspace", () => ({
  BrowserWorkspace: () => <input aria-label="Browser draft" defaultValue="Keep my work" />,
}));
vi.mock("@/features/files/workspace/explorer", async () => {
  const { lazy, Suspense } = await import("react");
  const FailedModule = lazy(() =>
    Promise.reject(new TypeError("Importing a module script failed.")),
  );
  return {
    default: () => (
      <Suspense>
        <FailedModule />
      </Suspense>
    ),
  };
});

const filesTab: WorkspaceTab = {
  id: "files",
  surfaceId: "files",
  groupKey: "tool:files",
  instanceKey: "files",
  title: "Files",
  route: "/files",
  sidebarVisible: true,
  state: null,
  createdAt: 1,
  lastFocusedAt: 1,
};
const browserTab: WorkspaceTab = {
  ...filesTab,
  id: "browser",
  surfaceId: "browser",
  groupKey: "tool:browser",
  route: "/browser",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  localStorage.clear();
});
afterEach(cleanup);

it("contains a rejected lazy module without unmounting the browser or navigation", async () => {
  render(
    <RenderErrorBoundary>
      <nav>Browser navigation</nav>
      <WorkspaceSurface tab={browserTab} />
      <WorkspaceSurface tab={filesTab} />
    </RenderErrorBoundary>,
  );
  const draft = screen.getByLabelText("Browser draft");
  fireEvent.change(draft, { target: { value: "Unsaved work" } });
  await screen.findByText("This tab could not be loaded");
  expect(screen.getByLabelText("Browser draft")).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe("Unsaved work");
  expect(screen.getByText("Browser navigation")).toBeTruthy();
  expect(screen.queryByText("Workspace render failed")).toBeNull();
});

it("can navigate to another surface after a tab failed", async () => {
  const { rerender } = render(<WorkspaceSurface tab={filesTab} />);
  await screen.findByText("This tab could not be loaded");
  rerender(<WorkspaceSurface tab={browserTab} />);
  expect(screen.getByLabelText("Browser draft")).toBeTruthy();
  expect(screen.queryByText("This tab could not be loaded")).toBeNull();
});

it("does not reset workspace snapshots when retrying a failed module request", async () => {
  localStorage.setItem("misty.providers.multipanel.v1", "saved-layout");
  localStorage.setItem("misty.explorer.fileTable.columnOrder", "saved-columns");
  render(<WorkspaceSurface tab={filesTab} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reload Misty" }));
  expect(localStorage.getItem("misty.providers.multipanel.v1")).toBe("saved-layout");
  expect(localStorage.getItem("misty.explorer.fileTable.columnOrder")).toBe("saved-columns");
  expect(localStorage.getItem("misty.explorer.resetWorkspaceOnNextLoad.v1")).toBeNull();
});
