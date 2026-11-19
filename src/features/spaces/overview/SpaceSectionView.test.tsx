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
vi.mock("@/features/account", () => ({
  useAuth: () => ({ user: { id: "one" }, accounts: [], transitioning: false }),
}));
vi.mock("../list/useSpacesStore", () => ({
  useSpacesStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
vi.mock("@/features/spaces/journal/notes/SpaceNotes", () => ({
  SpaceNotes: ({ spaceId }: { spaceId: string }) => <div>Notes in {spaceId}</div>,
}));
vi.mock("@/features/spaces/journal/drawings/SpaceDrawings", () => ({
  SpaceDrawings: ({ spaceId }: { spaceId: string }) => <div>Drawings in {spaceId}</div>,
}));
vi.mock("@/features/spaces/slides/SpaceSlides", () => ({
  SpaceSlides: ({ spaceId }: { spaceId: string }) => <div>Slides in {spaceId}</div>,
}));
vi.mock("@/features/spaces/data/SpaceData", () => ({
  SpaceData: ({ spaceId }: { spaceId: string }) => <div>Data in {spaceId}</div>,
}));
vi.mock("@/features/spaces/library/SpaceLibrary", () => ({
  SpaceLibrary: ({ spaceId }: { spaceId: string }) => <div>Library in {spaceId}</div>,
}));
vi.mock("../chat/SpaceChatEntry", () => ({
  SpaceChatEntry: ({ spaceId }: { spaceId: string }) => <div>Chat in {spaceId}</div>,
}));
vi.mock("../home/SpaceHome", () => ({
  SpaceHome: ({ space, page }: { space: { id: string }; page?: string }) => (
    <div>
      Home in {space.id}
      {page ? ` for ${page}` : ""}
    </div>
  ),
}));
afterEach(() => {
  cleanup();
});
// Docs and Whiteboards without an item show the home narrowed to their kind; the item opens them.
it.each([
  ["home", "Home", "", ""],
  ["notes", "Home", "", ""],
  ["drawings", "Home", "", ""],
  ["notes", "Notes", "?note=n1", ""],
  ["drawings", "Drawings", "", "d1"],
  ["slides", "Slides", "", "k1"],
  ["data", "Data", "", "w1"],
  ["media", "Library", "", ""],
  ["social", "Chat", "", ""],
])("opens %s as %s directly without an installed app", async (section, label, search, kind) => {
  render(
    <MemoryRouter
      initialEntries={[
        `/spaces/family/${section === "social" ? "social/misty" : section}${search}`,
      ]}
    >
      <SpaceSectionView spaceId="family" section={section} itemId={kind} />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText(new RegExp(`${label} in family`), {}, { timeout: 5000 }),
  ).toBeTruthy();
});

it.each([
  ["notes", "note"],
  ["slides", "deck"],
  ["data", "workbook"],
  ["drawings", "drawing"],
])("opens %s without an item as the %s page", async (section, kind) => {
  render(
    <MemoryRouter initialEntries={[`/spaces/family/${section}`]}>
      <SpaceSectionView spaceId="family" section={section} />
    </MemoryRouter>,
  );
  expect(await screen.findByText(`Home in family for ${kind}`, {}, { timeout: 5000 })).toBeTruthy();
});
