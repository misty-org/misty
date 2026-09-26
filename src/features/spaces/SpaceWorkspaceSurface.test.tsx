import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { WorkspaceTab } from "@/features/workspace/core";
import { SpaceWorkspaceSurface } from "./SpaceWorkspaceSurface";
const state = vi.hoisted(() => ({
  user: { id: "one" } as { id: string } | null,
  spaces: [{ id: "project", name: "Project", permissions: {} as Record<string, boolean> }],
  snapshotReady: true,
  error: null as string | null,
  load: vi.fn(),
  invitations: [],
  respondInvite: vi.fn(),
  setViewingSpace: vi.fn(),
}));
vi.mock("@/features/auth", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("./store/useSpacesStore", () => ({
  useSpacesStore: (select: (value: typeof state) => unknown) => select(state),
}));
vi.mock("./SpaceSectionView", () => ({
  SpaceSectionView: ({ section }: { section: string }) => (
    <input aria-label={`${section} draft`} defaultValue="kept draft" />
  ),
}));
vi.mock("./components/SpaceWorkspaceRail", () => ({
  SpaceWorkspaceRail: () => <aside aria-label="Space navigation" />,
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
  state.user = { id: "one" };
  state.snapshotReady = true;
  state.error = null;
  state.load.mockClear();
});
it("keeps the page available without a pull tab, overlay, or Escape-to-close behavior", () => {
  const { container } = mount();
  const draft = screen.getByRole("textbox", { name: "social draft" });
  fireEvent.change(draft, { target: { value: "unfinished" } });
  fireEvent.keyDown(draft, { key: "Escape" });
  expect((draft as HTMLInputElement).value).toBe("unfinished");
  expect(screen.getByRole("textbox", { name: "social draft" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Space navigation|Close Space sheet/ })).toBeNull();
  expect(container.querySelector('aside[aria-label="Space navigation"]')).not.toBeNull();
  expect(container.querySelector("[inert]")).toBeNull();
});
it("asks signed-out users to sign in", () => {
  state.user = null;
  mount();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("shows loading and lets users retry a failed snapshot", () => {
  state.snapshotReady = false;
  state.error = "Offline";
  mount();
  expect(screen.getByRole("status").textContent).toContain("Spaces could not be loaded");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.load).toHaveBeenCalledWith({ force: true });
});
