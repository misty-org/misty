import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Space } from "@/api/spaces/dto/entities";
import {
  activeLayoutView,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpacePageHeader } from "./SpacePageHeader";
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
  const space = useSpacesStore((state) =>
    state.spaces.find((item) => item.id === route.activeSpaceId),
  );
  return (
    <>
      {space ? <SpacePageHeader space={space} section={route.section} /> : null}
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

it("leads back to the Space home in the owning tab after loading it", async () => {
  const before = activeLayoutView(useWorkspaceStore.getState().layout)?.id;
  mount();
  expect(screen.queryByRole("navigation", { name: "Space sections" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back to Family home" }));
  await waitFor(() =>
    expect(activeLayoutView(useWorkspaceStore.getState().layout)?.route).toBe(
      "/spaces/family/home",
    ),
  );
  expect(preload).toHaveBeenCalledWith("home");
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.id).toBe(before);
});

it("follows the focused Space", () => {
  mount();
  act(() => open("/spaces/work/social"));
  expect(screen.getByRole("button", { name: "Back to Work home" })).toBeTruthy();
});

it("shows nothing on the home, which has its own header", () => {
  open("/spaces/family/home");
  mount();
  expect(screen.queryByRole("banner")).toBeNull();
  expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
});

it("names the Space without a switcher and exposes management directly", async () => {
  mount();
  expect(screen.queryByRole("button", { name: /Switch Space/ })).toBeNull();
  const management = screen.getByRole("navigation", { name: "Space management" });
  expect(within(management).getByRole("button", { name: "Members" })).toBeTruthy();
  // Usage is the account's, in the profile menu, not the Space's.
  expect(within(management).queryByRole("button", { name: "Usage" })).toBeNull();
  fireEvent.click(within(management).getByRole("button", { name: "Members" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(useSpacesStore.getState().loadMembers).toHaveBeenCalledWith("family");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("keeps the current page on load failure and ignores loads after the pane route changes", async () => {
  mount();
  preload.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Back to Family home" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.route).toBe("/spaces/family/notes");
  let finish!: () => void;
  preload.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to Family home" }));
  act(() => open("/agents"));
  await act(async () => finish());
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.route).toBe("/agents");
});
