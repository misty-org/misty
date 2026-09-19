import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useWorkspaceStore, workspaceSurfaceFromRoute, dockTabs } from "@/features/workspace";
import { useSpacesStore } from "@/features/spaces";
import { WorkspaceCanvas } from "./WorkspaceCanvas";

vi.mock("./WorkspaceDockTree", () => ({
  WorkspaceDockTree: () => <div>Workspace contents</div>,
  minimumForWorkspaceTabs: () => ({ width: 280, height: 180 }),
}));
vi.mock("./WorkspaceLayoutTabs", () => ({
  WorkspaceLayoutTabs: () => <nav aria-label="Window tabs" />,
}));

beforeEach(() => {
  useWorkspaceStore.persist.clearStorage();
  useWorkspaceStore.getState().reset();
  useSpacesStore.setState({ spaces: [], snapshotReady: false });
  const initial = dockTabs(useWorkspaceStore.getState().layout.root);
  useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute("/agents")!);
  for (const tab of initial) useWorkspaceStore.getState().closeTab(tab.id);
});
afterEach(cleanup);

it("lets a lone Agents view own its header and restores window tabs when another surface opens", () => {
  render(
    <MemoryRouter initialEntries={["/apps/agents"]}>
      <WorkspaceCanvas />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("navigation", { name: "Window tabs" })).toBeNull();
  act(() => {
    useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute("/spaces/family/notes")!);
  });
  expect(screen.getByRole("navigation", { name: "Window tabs" })).toBeTruthy();
});

it("preserves Windows caption controls even for a lone Agents view", () => {
  render(
    <MemoryRouter initialEntries={["/apps/agents"]}>
      <WorkspaceCanvas windowsTitlebarControls />
    </MemoryRouter>,
  );
  expect(screen.getByRole("navigation", { name: "Window tabs" })).toBeTruthy();
});
