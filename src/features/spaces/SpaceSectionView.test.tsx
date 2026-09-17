import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SpaceSectionView } from "./SpaceSectionView";
const state = vi.hoisted(() => ({
  spaces: [
    { id: "family", name: "Family", role: "member", permissions: {} as Record<string, boolean> },
  ],
  snapshotReady: true,
  loading: false,
  error: null,
  load: vi.fn(),
  loadSpace: vi.fn(),
}));
vi.mock("@/features/auth", () => ({
  useAuth: () => ({ user: { id: "one" }, accounts: [], transitioning: false }),
}));
vi.mock("./store/useSpacesStore", () => ({
  useSpacesStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock("@/features/notes/SpaceNotes", () => ({
  SpaceNotes: ({ spaceId }: { spaceId: string }) => <div>Notes in {spaceId}</div>,
}));
vi.mock("@/features/drawings/SpaceDrawings", () => ({
  SpaceDrawings: ({ spaceId }: { spaceId: string }) => <div>Drawings in {spaceId}</div>,
}));
vi.mock("@/features/spaces/planner/SpacePlanner", () => ({
  SpacePlanner: ({ spaceId }: { spaceId: string }) => <div>Planner in {spaceId}</div>,
}));
vi.mock("@/features/spaces/library/SpaceLibrary", () => ({
  SpaceLibrary: ({ spaceId }: { spaceId: string }) => <div>Library in {spaceId}</div>,
}));
vi.mock("./chat/SpaceChat", () => ({
  SpaceSocial: ({ spaceId, provider }: { spaceId: string; provider: string }) => (
    <div>
      Chat in {spaceId} via {provider}
    </div>
  ),
}));
vi.mock("./components/SpaceSettings", () => ({ SpaceSettings: () => null }));
vi.mock("@/features/home", () => ({ HomeDashboard: () => null }));
afterEach(() => {
  cleanup();
  state.spaces[0].permissions = {};
});
it.each([
  ["notes", "Notes"],
  ["drawings", "Drawings"],
  ["planner", "Planner"],
  ["library", "Library"],
  ["social", "Chat"],
])("opens %s directly without an installed app", async (section, label) => {
  render(
    <MemoryRouter>
      <SpaceSectionView spaceId="family" section={section} />
    </MemoryRouter>,
  );
  expect(await screen.findByText(new RegExp(`${label} in family`))).toBeTruthy();
});
it("retains Space permissions for direct links", () => {
  state.spaces[0].permissions = { "tasks.view": false };
  render(
    <MemoryRouter>
      <SpaceSectionView spaceId="family" section="planner" />
    </MemoryRouter>,
  );
  expect(screen.getByText("You don’t have access to this Space tool")).toBeTruthy();
  expect(screen.queryByText("Planner in family")).toBeNull();
});
