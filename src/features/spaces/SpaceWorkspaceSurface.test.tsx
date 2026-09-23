import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceTab } from "@/features/workspace/core";
import { SpaceWorkspaceSurface } from "./SpaceWorkspaceSurface";
const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => ({
  cancel: vi.fn(),
}));
const originalAnimate = HTMLElement.prototype.animate;
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  animate.mockClear();
});
const state = vi.hoisted(() => ({
  preload: vi.fn(async () => {}),
  user: { id: "one" } as { id: string } | null,
  spaces: [{ id: "project", name: "Project", permissions: {} as Record<string, boolean> }],
  snapshotReady: true,
  error: null,
  load: vi.fn(),
  invitations: [],
  respondInvite: vi.fn(),
  setViewingSpace: vi.fn(),
}));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("./store/useSpacesStore", () => ({
  useSpacesStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock("./components/SpaceSwitcher", () => ({
  SpaceSwitcher: () => <button>Switch Space</button>,
}));
vi.mock("./SpaceSectionView", () => ({
  preloadSpaceSection: state.preload,
  SpaceSectionView: ({ section }: { section: string }) => (
    <input aria-label={`${section} draft`} defaultValue="kept draft" />
  ),
}));
vi.mock("./components/SpaceManagementNavigation", () => ({
  SpaceManagementNavigation: () => null,
}));
vi.mock("./GlobalCreateSpaceDialog", () => ({ GlobalCreateSpaceDialog: () => null }));
const tab = { id: "space-tab", route: "/spaces/project/social" } as WorkspaceTab;
function mount() {
  return render(
    <MemoryRouter initialEntries={[tab.route]}>
      <SpaceWorkspaceSurface tab={tab} />
    </MemoryRouter>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: originalAnimate,
  });
  state.preload.mockReset().mockResolvedValue(undefined);
  state.user = { id: "one" };
  state.snapshotReady = true;
  state.spaces[0].permissions = {};
});
function openNav() {
  fireEvent.click(screen.getByRole("button", { name: "Show Space navigation" }));
}
it("starts tucked away and can close with the handle or Escape", () => {
  mount();
  expect(screen.queryByRole("navigation", { name: "Space tools" })).toBeNull();
  openNav();
  expect(screen.getByRole("navigation", { name: "Space tools" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide Space navigation" }));
  openNav();
  fireEvent.keyDown(screen.getByRole("button", { name: "Chat" }), { key: "Escape" });
  expect(screen.queryByRole("navigation", { name: "Space tools" })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Show Space navigation" }),
  );
});
it("keeps the current draft visible while the next tool loads", async () => {
  let resolve!: () => void;
  state.preload.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  mount();
  openNav();
  fireEvent.change(screen.getByLabelText("social draft"), { target: { value: "unfinished" } });
  fireEvent.click(screen.getByRole("button", { name: "Planner" }));
  expect((screen.getByLabelText("social draft") as HTMLInputElement).value).toBe("unfinished");
  await act(async () => resolve());
  expect(await screen.findByLabelText("planner draft")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Space tools" })).toBeNull();
});
it("dismisses navigation on outside click without hiding the page", () => {
  mount();
  openNav();
  fireEvent.pointerDown(screen.getByLabelText("social draft"));
  expect(screen.queryByRole("navigation", { name: "Space tools" })).toBeNull();
  expect(screen.getByLabelText("social draft")).toBeTruthy();
});
it("keeps the avatar dropdown inside the drawer and hides denied tools", () => {
  state.spaces[0].permissions = { "tasks.view": false };
  mount();
  openNav();
  expect(screen.getByRole("button", { name: "Switch Space" }).closest("nav")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Planner" })).toBeNull();
});
it("uses translation only and respects reduced motion", async () => {
  mount();
  openNav();
  animate.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Planner" }));
  await screen.findByLabelText("planner draft");
  await waitFor(() => expect(animate).toHaveBeenCalled());
  expect(animate.mock.calls[0][0]).toEqual([
    { transform: "translateX(32px)" },
    { transform: "translateX(0)" },
  ]);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  openNav();
  animate.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Library" }));
  await screen.findByLabelText("library draft");
  expect(animate).not.toHaveBeenCalled();
});
