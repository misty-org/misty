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
// Keep the real runtime guards and host initializers: a shallow tool mock used
// to hide missing service setup in the restored built-in entry point.
vi.mock("@/features/library/library/SpaceLibrary", async () => {
  const { libraryRuntime } = await import("@/features/library/library/LibraryRuntime");
  return {
    SpaceLibrary: ({ spaceId }: { spaceId: string }) => {
      expect(libraryRuntime().api).toBeTruthy();
      return <div>Library in {spaceId}</div>;
    },
  };
});
vi.mock("./chat/SpaceChatEntry", async () => {
  const { useSocialAuth } = await import("./chat/SocialRuntime");
  return {
    SpaceChatEntry: ({ spaceId }: { spaceId: string }) => {
      const { user } = useSocialAuth();
      expect(user?.id).toBe("one");
      return <div>Chat in {spaceId}</div>;
    },
  };
});
vi.mock("./home/SpaceHome", () => ({
  SpaceHome: ({ space }: { space: { id: string } }) => <div>Home in {space.id}</div>,
}));
afterEach(() => {
  cleanup();
});
it.each([
  ["home", "Home"],
  ["notes", "Notes"],
  ["drawings", "Drawings"],
  ["library", "Library"],
  ["social", "Chat"],
])("opens %s directly without an installed app", async (section, label) => {
  render(
    <MemoryRouter
      initialEntries={[`/spaces/family/${section === "social" ? "social/misty" : section}`]}
    >
      <SpaceSectionView spaceId="family" section={section} />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(new RegExp(`${label} in family`), {}, { timeout: 5000 }),
  ).toBeTruthy();
});
