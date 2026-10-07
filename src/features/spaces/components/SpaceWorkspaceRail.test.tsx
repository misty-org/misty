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
import { WorkspaceViewRouteScope } from "@/features/workspace/WorkspaceViewRouteScope";
import { useSpacePanelRoute } from "./spacePanel/spacePanelRoute";

const { preload } = vi.hoisted(() => ({ preload: vi.fn(async () => {}) }));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "one" } }) }));
vi.mock("../useSpaceOverview", () => ({
  useSpaceOverview: () => ({ items: [], loading: false, failed: false, retry: vi.fn() }),
}));
vi.mock("../useSpacePersonalItems", () => ({
  useSpacePersonalItems: () => ({ items: [], ready: true, error: "", retry: vi.fn() }),
}));
vi.mock("../SpaceSectionView", () => ({ preloadSpaceSection: preload }));
vi.mock("../chat/sidebar/useSpaceConversations", () => ({
  useSpaceConversations: () => ({
    conversations: [],
    loading: false,
    upsert: vi.fn(),
    remove: vi.fn(),
  }),
}));

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
    <WorkspaceViewRouteScope tab={activeTab}>
      <Rail />
    </WorkspaceViewRouteScope>
  ) : null;
}
function mount() {
  return render(
    <MemoryRouter initialEntries={["/spaces/family/notes"]}>
      <Harness />
    </MemoryRouter>,
  );
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
  ).toEqual(["All", "Chat", "Planner", "Journal", "Library"]);
  expect(within(nav).getByRole("link", { name: "Journal" }).getAttribute("aria-current")).toBe(
    "page",
  );
  fireEvent.click(within(nav).getByRole("link", { name: "Planner" }));
  await waitFor(() =>
    expect(activeLayoutView(useWorkspaceStore.getState().layout)?.route).toBe(
      "/spaces/family/planner",
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
  expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Recent items" })).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Space sections" });
  expect(within(nav).queryByRole("link", { name: "Planner" })).toBeNull();
  expect(within(nav).queryByRole("link", { name: "Library" })).toBeNull();
  expect(within(nav).getByRole("link", { name: "Chat" }).getAttribute("aria-current")).toBe("page");
});

it("names the Space without a switcher and exposes management directly", async () => {
  mount();
  expect(screen.getByRole("heading", { name: "Family" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Switch Space/ })).toBeNull();
  const management = screen.getByRole("navigation", { name: "Space management" });
  expect(within(management).getByRole("button", { name: "Members" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Family options" })).toBeNull();
  expect(
    management.closest("header")?.contains(screen.getByRole("heading", { name: "Family" })),
  ).toBe(true);
  fireEvent.click(within(management).getByRole("button", { name: "Usage" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.getByText("Cloud storage")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(within(management).getByRole("button", { name: "Members" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(useSpacesStore.getState().loadMembers).toHaveBeenCalledWith("family");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  act(() => open("/spaces/work/social"));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy());
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

it("keeps Library selected for Trash without duplicating Trash in the rail", () => {
  open("/spaces/family/library?collection=deleted");
  mount();
  expect(screen.queryByRole("link", { name: "Trash" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New item" })).toBeNull();
  expect(screen.getByRole("link", { name: "Library" }).getAttribute("aria-current")).toBe("page");
});

it("hides Trash when Library access is denied", () => {
  useSpacesStore.setState({
    spaces: [{ ...space("family", "Family"), permissions: { "library.view": false } }],
  });
  mount();
  expect(screen.queryByRole("link", { name: "Trash" })).toBeNull();
});
