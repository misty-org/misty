import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  activeLayoutView,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { WorkspaceSpaceNavigation } from "./WorkspaceSpaceNavigation";

beforeEach(() => useWorkspaceStore.getState().reset());
afterEach(cleanup);

it("opens Spaces through one global destination and closes the mobile menu", () => {
  const onOpen = vi.fn();
  render(
    <MemoryRouter>
      <WorkspaceSpaceNavigation activeTab={undefined} onOpen={onOpen} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Spaces" }));
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.surfaceId).toBe("space");
  expect(onOpen).toHaveBeenCalledOnce();
  expect(screen.queryByRole("navigation", { name: "Space sections" })).toBeNull();
});

it("marks Spaces active for a section inside a Space", () => {
  const tab = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/spaces/family/library")!);
  render(
    <MemoryRouter>
      <WorkspaceSpaceNavigation activeTab={tab} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Spaces" }).getAttribute("aria-current")).toBe("page");
});
