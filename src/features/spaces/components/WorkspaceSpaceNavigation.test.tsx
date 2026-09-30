import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  activeLayoutView,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSpacesStore } from "../store/useSpacesStore";
import { WorkspaceSpaceNavigation } from "./WorkspaceSpaceNavigation";
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "one" } }) }));
const space = (id: string, name: string): Space => ({
  id,
  name,
  owner_user_id: "one",
  role: "owner",
  is_default: false,
  member_count: 1,
  pending_count: 0,
  is_shared: true,
  created_at: "2026-09-25T00:00:00Z",
  updated_at: "2026-09-25T00:00:00Z",
});
beforeEach(() => {
  localStorage.clear();
  useWorkspaceStore.getState().reset();
  useSpacesStore.setState({ spaces: [space("family", "Family"), space("work", "Work")] });
});
afterEach(() => {
  cleanup();
  useSpacesStore.setState({ spaces: [] });
});
function mount(activeTab = activeLayoutView(useWorkspaceStore.getState().layout) ?? undefined) {
  const onOpen = vi.fn();
  render(
    <MemoryRouter>
      <WorkspaceSpaceNavigation activeTab={activeTab} onOpen={onOpen} />
    </MemoryRouter>,
  );
  return onOpen;
}
it("keeps the Space stack open until the user closes it, across mounts", () => {
  mount();
  const toggle = screen.getByRole("button", { name: "Spaces" });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  cleanup();
  mount();
  expect(screen.getByRole("button", { name: "Spaces" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
});
it("opens a Space from its avatar without closing the stack", () => {
  const onOpen = mount();
  fireEvent.click(screen.getByRole("button", { name: "Work" }));
  const view = activeLayoutView(useWorkspaceStore.getState().layout);
  expect(view?.surfaceId).toBe("space");
  expect(view?.route.startsWith("/spaces/work/")).toBe(true);
  expect(onOpen).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Spaces" }).getAttribute("aria-expanded")).toBe("true");
});
it("marks the active Space and the Spaces toggle", () => {
  const tab = useWorkspaceStore
    .getState()
    .openSurface(workspaceSurfaceFromRoute("/spaces/family/library")!);
  mount(tab);
  expect(screen.getByRole("button", { name: "Spaces" }).dataset.active).toBe("true");
  expect(screen.getByRole("button", { name: "Family" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: "Work" }).getAttribute("aria-current")).toBeNull();
});
