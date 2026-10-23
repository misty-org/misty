import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Space } from "@/api/spaces/dto/entities";
import {
  activeLayoutView,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { useSpacesStore } from "../store/useSpacesStore";
import { SpacePageShortcuts } from "./SpacePageShortcuts";
import { WorkspaceViewRouteScope } from "@/features/workspace/WorkspaceViewRouteScope";
import { useSpaceRoute } from "../spaceRoute";

const { preload, shortcuts } = vi.hoisted(() => ({
  preload: vi.fn(async () => {}),
  shortcuts: new Map<string, () => void>(),
}));
vi.mock("@/features/shortcuts", () => ({
  useShortcutHandler: (id: string, handler: () => void) => shortcuts.set(id, handler),
}));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: { id: "one" } }) }));
vi.mock("../SpaceSectionView", () => ({ preloadSpaceSection: preload }));
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
  const route = useSpaceRoute();
  const space = useSpacesStore((state) =>
    state.spaces.find((item) => item.id === route.activeSpaceId),
  );
  return space ? <SpacePageShortcuts space={space} /> : null;
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

const route = () => activeLayoutView(useWorkspaceStore.getState().layout)?.route;
const press = (id: string) => act(async () => shortcuts.get(id)!());

it("opens the Space home in the owning tab after loading it", async () => {
  const before = activeLayoutView(useWorkspaceStore.getState().layout)?.id;
  mount();
  await press("space.section_1");
  await waitFor(() => expect(route()).toBe("/spaces/family/home"));
  expect(preload).toHaveBeenCalledWith("home");
  expect(activeLayoutView(useWorkspaceStore.getState().layout)?.id).toBe(before);
});

it("opens the home's filters with the other section shortcuts", async () => {
  mount();
  await press("space.section_2");
  await waitFor(() => expect(route()).toBe("/spaces/family/home?filter=notes"));
  await press("space.section_5");
  await waitFor(() => expect(route()).toBe("/spaces/family/home?filter=code"));
});

it("follows the focused Space", async () => {
  mount();
  act(() => open("/spaces/work/social"));
  await press("space.section_1");
  await waitFor(() => expect(route()).toBe("/spaces/work/home"));
});

it("keeps the current page on load failure and ignores loads after the pane route changes", async () => {
  mount();
  preload.mockRejectedValueOnce(new Error("offline"));
  await press("space.section_1");
  expect(route()).toBe("/spaces/family/notes");
  let finish!: () => void;
  preload.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await press("space.section_1");
  act(() => open("/agents"));
  await act(async () => finish());
  expect(route()).toBe("/agents");
});
