import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  dockTreeViews,
} from "@/features/app-windows";
import { useSpacesStore } from "@/features/spaces";
import { WorkspaceCanvas } from "./WorkspaceCanvas";

vi.mock("./WorkspaceDockTree", () => ({
  WorkspaceDockTree: () => <div>Workspace contents</div>,
}));
vi.mock("./dockSplitFit", () => ({
  minimumForWorkspaceViews: () => ({ width: 280, height: 180 }),
}));
vi.mock("./WorkspaceSidebar", () => ({
  WorkspaceSidebar: () => <nav aria-label="Sidebar" />,
}));

beforeEach(() => {
  useWorkspaceStore.persist.clearStorage();
  useWorkspaceStore.getState().reset();
  useSpacesStore.setState({ spaces: [], snapshotReady: false });
  const initial = dockTreeViews(useWorkspaceStore.getState().layout.root);
  useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute("/agents")!);
  for (const tab of initial) useWorkspaceStore.getState().closeView(tab.id);
});
afterEach(cleanup);

it("keeps the sidebar for a lone Agents view", () => {
  render(
    <MemoryRouter initialEntries={["/apps/agents"]}>
      <WorkspaceCanvas />
    </MemoryRouter>,
  );
  expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy();
  act(() => {
    useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute("/spaces/family/notes")!);
  });
  expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy();
});

it("preserves Windows caption controls even for a lone Agents view", () => {
  render(
    <MemoryRouter initialEntries={["/apps/agents"]}>
      <WorkspaceCanvas windowsTitlebarControls />
    </MemoryRouter>,
  );
  expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeTruthy();
});
