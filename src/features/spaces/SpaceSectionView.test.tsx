import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SpaceSectionView } from "./SpaceSectionView";
const state = vi.hoisted(() => ({
  spaces: [{ id: "family", name: "Family", role: "member" }],
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
vi.mock("@/features/journal/notes/SpaceNotes", () => ({
  SpaceNotes: ({ spaceId }: { spaceId: string }) => <div>Notes in {spaceId}</div>,
}));
vi.mock("@/features/journal/drawings/SpaceDrawings", () => ({
  SpaceDrawings: ({ spaceId }: { spaceId: string }) => <div>Drawings in {spaceId}</div>,
}));
vi.mock("@/features/library/SpaceLibrary", () => ({
  SpaceLibrary: ({ spaceId }: { spaceId: string }) => <div>Library in {spaceId}</div>,
}));
vi.mock("./chat/SpaceChatEntry", () => ({
  SpaceChatEntry: ({ spaceId }: { spaceId: string }) => <div>Chat in {spaceId}</div>,
}));
vi.mock("./home/SpaceHome", () => ({
  SpaceHome: ({ space }: { space: { id: string } }) => <div>Home in {space.id}</div>,
}));
afterEach(() => {
  cleanup();
});
// Notes and Drawings without an item show the home, so the item opens them.
it.each([
  ["home", "Home", "", ""],
  ["notes", "Home", "", ""],
  ["drawings", "Home", "", ""],
  ["notes", "Notes", "?note=n1", ""],
  ["drawings", "Drawings", "", "d1"],
  ["library", "Library", "", ""],
  ["social", "Chat", "", ""],
])("opens %s as %s directly without an installed app", async (section, label, search, kind) => {
  render(
    <MemoryRouter
      initialEntries={[
        `/spaces/family/${section === "social" ? "social/misty" : section}${search}`,
      ]}
    >
      <SpaceSectionView spaceId="family" section={section} studioKind={kind} />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(new RegExp(`${label} in family`), {}, { timeout: 5000 }),
  ).toBeTruthy();
});
