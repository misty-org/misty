import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import {
  activeLayoutView,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpaceWorkspaceRail } from "./SpaceWorkspaceRail";
import { WorkspaceTabRouteScope } from "@/features/workspace/WorkspaceTabRouteScope";
import { useSpacePanelRoute } from "./spacePanel/spacePanelRoute";

const { preload } = vi.hoisted(() => ({ preload: vi.fn(async () => {}) }));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "one" } }) }));
vi.mock("../SpaceSectionView", () => ({ preloadSpaceSection: preload }));
vi.mock("./spacePanel/useAgentUsage", () => ({ useBillingUsage: () => undefined }));
vi.mock("./spacePanel/useSpaceLibraryUsage", () => ({ useSpaceLibraryUsage: () => undefined }));

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
function open(path: string) {
  useWorkspaceStore.getState().openSurface(workspaceSurfaceFromRoute(path)!);
}
function Rail() {
  const route = useSpacePanelRoute();
  const location = useLocation();
  return (
    <>
      <SpaceWorkspaceRail activeSpaceId={route.activeSpaceId} section={route.section} />
      <output data-testid="settings-return">{location.state?.spaceSettingsReturnTo ?? ""}</output>
    </>
  );
}
function Harness() {
  const activeTab = useWorkspaceStore((state) => activeLayoutView(state.layout) ?? undefined);
  return activeTab ? (
    <WorkspaceTabRouteScope tab={activeTab}>
      <Rail />
    </WorkspaceTabRouteScope>
  ) : null;
}
function mount() {
  return render(
    <MemoryRouter initialEntries={["/spaces/family/notes"]}>
      <Harness />
    </MemoryRouter>,
  );
}
function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /Switch Space/ }), {
    button: 0,
    ctrlKey: false,
  });
}
beforeEach(() => {
  useWorkspaceStore.getState().reset();
  useSpacesStore.setState({
    spaces: [space("family", "Family"), space("work", "Work")],
    snapshotReady: true,
    membersBySpace: {},
    presenceBySpace: {},
    loadMembers: vi.fn(async () => {}),
  });
  preload.mockReset().mockResolvedValue(undefined);
  open("/spaces/family/notes");
});
afterEach(() => {
  cleanup();
  useSpacesStore.setState({ spaces: [] });
  useWorkspaceStore.getState().reset();
});

it("opens a section in the owning Space tab after loading it", async () => {
  const before = activeLayoutView(useWorkspaceStore.getState().layout)?.id;
  mount();
  const nav = screen.getByRole("navigation", { name: "Space sections" });
  expect(
    within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent),
  ).toEqual(["Chat", "Planner", "Journal", "Library"]);
  expect(within(nav).getByRole("link", { name: "Journal" }).getAttribute("aria-current")).toBe(
    "page",
  );
  fireEvent.click(within(nav).getByRole("link", { name: "Planner" }));
  await waitFor(() =>
    expect(activeLayoutView(useWorkspaceStore.getState().layout)?.route).toBe(
      "/spaces/family/planner/tasks/board",
    ),
  );
  expect(preload).toHaveBeenCalledWith("planner");
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.id).toBe(before);
});

it("follows the focused Space and hides pages the user cannot access", () => {
  useSpacesStore.setState({
    spaces: [
      space("family", "Family"),
      { ...space("work", "Work"), permissions: { "tasks.view": false, "library.view": false } },
    ],
  });
  mount();
  act(() => open("/spaces/work/social"));
  expect(screen.getByRole("button", { name: /current Space: Work/ })).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Space sections" });
  expect(within(nav).queryByRole("link", { name: "Planner" })).toBeNull();
  expect(within(nav).queryByRole("link", { name: "Library" })).toBeNull();
  expect(within(nav).getByRole("link", { name: "Chat" }).getAttribute("aria-current")).toBe("page");
});

it("exposes management directly and keeps Space switching separate", async () => {
  mount();
  openMenu();
  for (const name of ["Family", "Work", "New Space"])
    expect(screen.getByRole("menuitem", { name })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Members" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  const management = screen.getByRole("navigation", { name: "Space management" });
  expect(within(management).getByRole("button", { name: "Members" })).toBeTruthy();
  expect(within(management).getByRole("link", { name: "Settings" })).toBeTruthy();
  fireEvent.click(within(management).getByRole("button", { name: "Usage" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Your personal allowance")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(within(management).getByRole("button", { name: "Members" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(useSpacesStore.getState().loadMembers).toHaveBeenCalledWith("family");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await act(async () =>
    fireEvent.click(within(management).getByRole("link", { name: "Settings" })),
  );
  await waitFor(() =>
    expect(activeLayoutView(useWorkspaceStore.getState().layout)?.route).toBe(
      "/spaces/family/settings/general",
    ),
  );
  expect(screen.getByTestId("settings-return").textContent).toBe("/spaces/family/notes");
  openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Work" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /current Space: Work/ })).toBeTruthy(),
  );
});

it("keeps the current page on load failure and ignores loads after the pane route changes", async () => {
  mount();
  preload.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("link", { name: "Planner" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.route).toBe("/spaces/family/notes");
  let finish!: () => void;
  preload.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("link", { name: "Planner" }));
  act(() => open("/files"));
  await act(async () => finish());
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.route).toBe("/files");
});
